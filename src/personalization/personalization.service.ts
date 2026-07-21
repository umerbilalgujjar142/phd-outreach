import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { ProfessorsService } from '../professors/professors.service';
import { Professor } from '../professors/professor.model';
import { OWNER_PROFILE } from './owner-profile';

export interface PersonalizeResult {
  id: string;
  professorName: string;
  ok: boolean;
  snippet?: string;
  error?: string;
}

/**
 * Step 4 (PROJECT.md Section 8): shell out to the Claude Code CLI (`claude -p`)
 * to write 2-3 tailored opening sentences per professor. Subscription-based,
 * so no Anthropic API key and no per-call billing. The prompt is fed on STDIN
 * to avoid any shell-quoting/escaping issues across platforms.
 */
@Injectable()
export class PersonalizationService {
  private readonly logger = new Logger(PersonalizationService.name);
  private readonly claudeBin: string;
  private readonly timeoutMs = 120_000;

  constructor(
    private readonly professors: ProfessorsService,
    private readonly config: ConfigService,
  ) {
    this.claudeBin = this.config.get<string>('CLAUDE_BIN') ?? 'claude';
  }

  /** Generate + store a snippet for one professor. */
  async personalizeOne(id: string, force = false): Promise<PersonalizeResult> {
    const professor = await this.professors.findOne(id);
    return this.run(professor, force);
  }

  /**
   * Personalize a batch that still needs it. Runs SEQUENTIALLY (one `claude`
   * call at a time) to stay gentle on the subscription and machine.
   */
  async personalizePending(
    limit = 25,
    force = false,
  ): Promise<{ processed: number; ok: number; failed: number; results: PersonalizeResult[] }> {
    const batch = await this.professors.findNeedingPersonalization(limit, force);
    const results: PersonalizeResult[] = [];
    for (const professor of batch) {
      results.push(await this.run(professor, force));
    }
    const ok = results.filter((r) => r.ok).length;
    this.logger.log(
      `Personalized ${ok}/${results.length} (limit=${limit}, force=${force})`,
    );
    return {
      processed: results.length,
      ok,
      failed: results.length - ok,
      results,
    };
  }

  /**
   * Run an arbitrary prompt through `claude -p` and return the cleaned result
   * (text between <snippet></snippet>). Reused by the motivation-letter
   * generator for its per-professor paragraph.
   */
  async complete(prompt: string): Promise<string> {
    return this.sanitize(await this.callClaude(prompt));
  }

  /**
   * Run a prompt through `claude -p` and return the cleaned raw output WITHOUT
   * <snippet> extraction — for callers that need structured output (e.g. the
   * apply form-planner parsing JSON). Only mojibake repair + trim is applied.
   */
  async completeRaw(prompt: string): Promise<string> {
    return this.repairMojibake((await this.callClaude(prompt)).trim());
  }

  /**
   * Generate a snippet for a professor object WITHOUT persisting it. Used by the
   * self-test so the verification email exercises the real (fixed) prompt rather
   * than a canned string.
   */
  async previewSnippet(professor: Professor): Promise<string> {
    return this.sanitize(await this.callClaude(this.buildPrompt(professor)));
  }

  private async run(professor: Professor, force: boolean): Promise<PersonalizeResult> {
    if (professor.personalizedSnippet && !force) {
      return {
        id: professor.id,
        professorName: professor.professorName,
        ok: true,
        snippet: professor.personalizedSnippet,
      };
    }
    try {
      const snippet = this.sanitize(await this.callClaude(this.buildPrompt(professor)));
      if (!snippet) throw new Error('Claude returned empty output');
      await this.professors.savePersonalization(professor.id, snippet, new Date());
      this.logger.log(`Personalized ${professor.professorName} (${professor.id})`);
      return { id: professor.id, professorName: professor.professorName, ok: true, snippet };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.warn(`Personalize failed for ${professor.id}: ${error}`);
      return { id: professor.id, professorName: professor.professorName, ok: false, error };
    }
  }

  /** Build the instruction sent to `claude -p`. */
  private buildPrompt(p: Professor): string {
    const research = [
      p.matchReason && `Matched research: ${p.matchReason}`,
      p.matchedTags?.length && `Topic tags: ${p.matchedTags.join(', ')}`,
      p.departmentLab && `Department/Lab: ${p.departmentLab}`,
    ]
      .filter(Boolean)
      .join('\n');

    return `
You are helping a PhD applicant write the OPENING of a cold outreach email to a
professor. Write 2-3 sentences (max ~70 words) that connect the APPLICANT's own
background to THIS professor's research area. Be concrete and specific; never
generic ("your impressive work" is banned).

HARD RULES — follow exactly:
- Pronouns: "you"/"your" ALWAYS mean the PROFESSOR; "I"/"my" ALWAYS mean the
  APPLICANT. The applicant's MS thesis, projects, and experience belong to the
  APPLICANT — NEVER attribute them to the professor. (Writing "Your master's
  thesis..." about the applicant's own thesis is WRONG.)
- Do NOT invent papers, awards, or specific results for the professor. If only a
  general topic/tags are provided (no specific project of theirs), connect the
  applicant's background to that research AREA or the group's focus in general
  terms — do not fabricate specifics.
- Warm, professional, respectful tone. Lead with the genuine research
  connection; do not open with a blunt demand or a question.
- Do NOT mention attachments, a CV, transcripts, or any documents.
- No greeting ("Dear ..."), no sign-off, no subject line, no quotation marks.

Think silently. Output the finished opening and NOTHING else, wrapped exactly
between <snippet> and </snippet> tags. Put no text outside those tags.

PROFESSOR (the recipient — "you"):
Name: ${p.professorName}
University: ${p.university}${p.country ? ` (${p.country})` : ''}
${research || 'Research: (only a general security/ML topic match is available — connect in general terms, do not invent specifics)'}

APPLICANT (the sender — "I"):
${OWNER_PROFILE}
`.trim();
  }

  /** Spawn `claude -p`, feed the prompt on stdin, resolve trimmed stdout. */
  private callClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // shell:true so Windows resolves the `claude` shim (claude.cmd) on PATH;
      // the prompt travels via stdin, so nothing is interpolated into the shell.
      const child = spawn(this.claudeBin, ['-p'], {
        shell: true,
        windowsHide: true,
      });

      // Collect raw Buffers and decode ONCE as UTF-8 at the end. Decoding each
      // chunk separately (`d.toString()`) can split a multi-byte UTF-8 sequence
      // across a chunk boundary and corrupt it (e.g. an em-dash "—").
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude -p timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout.on('data', (d: Buffer) => outChunks.push(d));
      child.stderr.on('data', (d: Buffer) => errChunks.push(d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn ${this.claudeBin}: ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(outChunks).toString('utf8');
        const stderr = Buffer.concat(errChunks).toString('utf8');
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude -p exited ${code}: ${stderr.trim() || stdout.trim()}`));
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  /**
   * Extract the text between <snippet></snippet> (the model is told to wrap its
   * answer there, which reliably strips any "thinking out loud" preamble).
   * Falls back to the last non-empty paragraph if the tags are missing.
   */
  private sanitize(raw: string): string {
    const text = this.repairMojibake(raw.trim());
    const tagged = text.match(/<snippet>([\s\S]*?)<\/snippet>/i);
    let out = tagged ? tagged[1] : text.split(/\n\s*\n/).filter(Boolean).pop() ?? text;
    return out
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+\n/g, '\n')
      .trim();
  }

  /**
   * Repair CP1252 "mojibake": the Claude CLI's UTF-8 punctuation can reach us
   * re-decoded through Windows-1252, so an em-dash "—" (bytes E2 80 94) lands as
   * "â€" (U+00E2 U+20AC U+201D). Each mojibake sequence starts "â€"; map the
   * ones that occur in prose back to the intended Unicode character. Guarded so
   * clean output (no "â€" marker) is returned untouched.
   */
  private repairMojibake(s: string): string {
    // The Claude CLI's UTF-8 punctuation can arrive re-decoded through
    // Windows-1252: an em-dash (bytes E2 80 94) becomes chars whose stored
    // form is U+00E2 U+20AC U+201D. Every such sequence starts U+00E2 U+20AC
    // and has a distinct 3rd char, so replacement order is irrelevant.
    if (!s.includes("â€")) return s;
    return s
      .replace(/â€”/g, "—") // em dash
      .replace(/â€“/g, "–") // en dash
      .replace(/â€™/g, "’") // right single quote
      .replace(/â€˜/g, "‘") // left single quote
      .replace(/â€œ/g, "“") // left double quote
      .replace(/â€/g, "”") // right double quote
      .replace(/â€¦/g, "…"); // ellipsis
  }
}
