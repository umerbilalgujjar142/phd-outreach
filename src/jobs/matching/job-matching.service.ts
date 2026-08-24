import { Injectable } from '@nestjs/common';
import { RoleType } from '../job-status.enum';
import { jobNeedsSponsorship, SKILL_INVENTORY } from '../job-profile';
import { ScrapedJob } from '../discovery/job-discovery.types';
import {
  DEV_ROLE_RE,
  FOREIGN_STACK_RE,
  JS_STACK_RE,
  ROLE_SIGNALS,
} from './job-skills';

export interface JobMatchResult {
  qualifies: boolean;
  roleType: RoleType;
  /** Umer's real skills (from SKILL_INVENTORY) that this JD asks for. */
  matchedSkills: string[];
  /** 0–100 heuristic fit. */
  fitScore: number;
  needsSponsorship: boolean;
  reason: string;
}

/**
 * Deterministic matcher run on EVERY scraped job at ingest (fast, no Claude).
 * Decides whether the posting is a real, JS-stack software role that fits Umer,
 * classifies the role family (→ base CV), computes a heuristic fit score, and
 * flags whether the job would need visa sponsorship. A later Claude pass may
 * refine fitScore/reason on the survivors.
 */
@Injectable()
export class JobMatchingService {
  match(job: ScrapedJob): JobMatchResult {
    const title = (job.title || '').trim();
    const text = `${title} ${(job.tags || []).join(' ')} ${job.description || ''}`;
    const needsSponsorship = jobNeedsSponsorship(job.country, job.remote);

    // Gate 1: must be a software-development role.
    if (!DEV_ROLE_RE.test(title) && !DEV_ROLE_RE.test(text.slice(0, 400))) {
      return this.reject('not a software-development role', needsSponsorship);
    }

    // Gate 2: exclude roles built on a stack that ISN'T Umer's (Python/.NET/
    // Flask/Java/PHP/Go/Ruby/Rust). Two checks:
    //   (a) the TITLE names a foreign stack without any JS/React/Node signal
    //       (e.g. "Software Developer … Python Integrations", ".NET Engineer");
    //   (b) a foreign stack appears anywhere and NONE of Umer's core JS stack
    //       does (a Python-primary role that only lists JS as "nice to have").
    const hasJsTitle = JS_STACK_RE.test(title);
    const hasJsText = JS_STACK_RE.test(text);
    const foreignInTitle = FOREIGN_STACK_RE.test(title);
    const foreignInText = FOREIGN_STACK_RE.test(text);
    if (foreignInTitle && !hasJsTitle) {
      return this.reject(`non-JS stack role by title — outside Umer's stack`, needsSponsorship);
    }
    if (foreignInText && !hasJsText) {
      return this.reject(`primary non-JS stack (Python/.NET/Java/etc.) — outside Umer's stack`, needsSponsorship);
    }
    const hasJs = hasJsText;

    // Skill overlap against Umer's real inventory.
    const lower = text.toLowerCase();
    const matchedSkills = SKILL_INVENTORY.filter((s) => lower.includes(s.toLowerCase()));

    // Role classification from the TITLE + tags only (high-signal, author-set).
    // Matching against the full description misclassifies — a frontend/backend
    // JD that merely mentions "iOS/Android/mobile" in passing would look mobile.
    const roleText = `${title} ${(job.tags || []).join(' ')}`;
    let roleType = RoleType.FULLSTACK;
    let best = 0;
    for (const sig of ROLE_SIGNALS) {
      if (sig.re.test(roleText) && sig.weight > best) {
        best = sig.weight;
        roleType = sig.role;
      }
    }

    const fitScore = this.score({ matchedSkills, hasJs, needsSponsorship, remote: job.remote, roleClarity: best });
    const reason =
      `Role=${roleType}; ${matchedSkills.length} matching skill(s)` +
      `${job.remote ? '; remote' : ''}` +
      `${job.sponsorshipOffered ? '; sponsorship offered' : needsSponsorship ? '; needs sponsorship' : '; no sponsorship needed'}` +
      `. Fit ${fitScore}/100.`;

    return { qualifies: true, roleType, matchedSkills, fitScore, needsSponsorship, reason };
  }

  private score(o: {
    matchedSkills: string[];
    hasJs: boolean;
    needsSponsorship: boolean;
    remote: boolean;
    roleClarity: number;
  }): number {
    let s = 35;
    s += Math.min(36, o.matchedSkills.length * 6); // skill overlap is the biggest lever
    if (o.hasJs) s += 12; // core stack present
    s += o.roleClarity * 3; // clearer role → better CV targeting
    if (o.remote) s += 6; // remote = fastest win (no sponsorship)
    else if (!o.needsSponsorship) s += 4; // UAE/GCC = also no sponsorship
    else s -= 6; // sponsorship-required = harder, rank lower
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  private reject(reason: string, needsSponsorship: boolean): JobMatchResult {
    return {
      qualifies: false,
      roleType: RoleType.OTHER,
      matchedSkills: [],
      fitScore: 0,
      needsSponsorship,
      reason: `Excluded: ${reason}`,
    };
  }
}
