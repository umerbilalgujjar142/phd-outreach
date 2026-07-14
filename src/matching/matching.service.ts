import { Injectable } from '@nestjs/common';
import {
  BOILERPLATE_PRONE_TAGS,
  IN_DOMAIN_RE,
  NON_PHD_TITLE_RE,
  OUT_DOMAIN_RE,
  PHD_TITLE_RE,
  REQUIRES_PHD_RE,
  STRONG_SECURITY_RE,
  TAG_RULES,
} from './research-tags';

/** Structured signal for matching — fields carry very different trust. */
export interface MatchInput {
  title?: string;
  researchField?: string;
  description?: string;
}

export interface MatchResult {
  /** All matched tag names (tier 1 first, then tier 2). */
  tags: string[];
  tier1Count: number;
  tier2Count: number;
  /** True if it qualifies at all (passes discipline gate + has a real tag). */
  qualifies: boolean;
  /** Set when rejected by the discipline gate (for logging/telemetry). */
  excludedReason?: string;
  /** Human-readable reason string stored on the professor row. */
  reason: string;
}

@Injectable()
export class MatchingService {
  /**
   * Match a posting against the Section 7 tags with a precision-first design:
   *
   *  1. "primary" text = title + research field (high signal, professor-authored).
   *     "full" text also includes the scraped body (noisy, has boilerplate).
   *  2. Discipline gate: reject clearly non-CS fields (mechanical, civil,
   *     materials, chemistry, medicine, …) unless a strong security term is
   *     present. Computing/AI/networking fields pass.
   *  3. Boilerplate-prone tags (privacy) only count in the primary zone, so the
   *     site's GDPR notice can't fake a match.
   *
   * Accepts a structured MatchInput or a bare string (treated as primary text).
   */
  match(input: MatchInput | string): MatchResult {
    const { title, researchField, description } =
      typeof input === 'string'
        ? { title: input, researchField: '', description: '' }
        : input;

    const clean = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();
    const primary = `${clean(title)} ${clean(researchField)}`.trim();
    const full = `${primary} ${clean(description)}`.trim();
    const disciplineText = `${clean(researchField)} ${clean(title)}`.trim();

    // Position-level gate: keep PhD-entry positions only (skip postdoc/faculty/
    // senior roles that require an already-completed PhD). A PhD signal in the
    // title always wins; otherwise a senior title or a "must hold a PhD"
    // requirement excludes it.
    const titleClean = clean(title);
    if (!PHD_TITLE_RE.test(titleClean)) {
      if (NON_PHD_TITLE_RE.test(titleClean) || REQUIRES_PHD_RE.test(clean(description))) {
        return {
          tags: [],
          tier1Count: 0,
          tier2Count: 0,
          qualifies: false,
          excludedReason: 'not a PhD-entry position (postdoc/faculty/requires PhD)',
          reason: 'Excluded: postdoc/senior position — requires a completed PhD',
        };
      }
    }

    // The research FIELD is authoritative for discipline. A clearly non-CS
    // field (e.g. "Mechanical engineering", "Biomedical engineering") stays
    // OFF-domain even if the TITLE name-drops "machine learning" — merely
    // USING ML in another engineering discipline is not a CS/security position.
    const fieldText = clean(researchField);
    const fieldOut = !!fieldText && OUT_DOMAIN_RE.test(fieldText) && !IN_DOMAIN_RE.test(fieldText);
    const inDomain = !fieldOut && IN_DOMAIN_RE.test(disciplineText);
    const outDomain = fieldOut || (!inDomain && OUT_DOMAIN_RE.test(disciplineText));
    // Rescue must come from the TITLE/FIELD, never the body — a stray strong
    // term in the page boilerplate (e.g. "privacy-preserving" in a GDPR notice)
    // must not drag an off-domain chemistry/optics posting back in.
    const strongPrimary = STRONG_SECURITY_RE.test(primary);

    // Discipline gate: drop off-topic faculties that only matched on a stray
    // keyword, unless the title/field carries an unambiguous security signal.
    if (outDomain && !strongPrimary) {
      const field = clean(researchField);
      return {
        tags: [],
        tier1Count: 0,
        tier2Count: 0,
        qualifies: false,
        excludedReason: `off-domain discipline${field ? ` (${field})` : ''}, no security signal`,
        reason: `Excluded: off-domain discipline${field ? ` (${field})` : ''}; no security/ML signal`,
      };
    }

    // Collect matches, tracking whether each hit was in the trusted primary zone.
    const matched: { tag: string; tier: 1 | 2; inPrimary: boolean }[] = [];
    for (const rule of TAG_RULES) {
      const inPrimary = rule.patterns.some((re) => re.test(primary));
      const inFull = inPrimary || rule.patterns.some((re) => re.test(full));
      if (!inFull) continue;
      // Boilerplate-prone tags only count from the primary (title/field) zone.
      if (BOILERPLATE_PRONE_TAGS.has(rule.tag) && !inPrimary) continue;
      matched.push({ tag: rule.tag, tier: rule.tier, inPrimary });
    }

    // A strong security term in the title/field (e.g. "hardware security",
    // "side-channel") may rescue a posting past the discipline gate without
    // matching a specific Section 7 tag — record it as general cybersecurity.
    if (matched.length === 0 && strongPrimary) {
      matched.push({ tag: 'Cybersecurity (general)', tier: 1, inPrimary: true });
    }

    const tier1 = matched.filter((m) => m.tier === 1).map((m) => m.tag);
    const tier2 = matched.filter((m) => m.tier === 2).map((m) => m.tag);
    const tags = [...tier1, ...tier2];
    const hasPrimaryTag = matched.some((m) => m.inPrimary);

    // Qualify only when the posting is on-domain, security-strong, or the tag
    // was found in the high-signal zone — never on a lone body-text keyword in
    // an unknown discipline.
    const qualifies = tags.length > 0 && (inDomain || strongPrimary || hasPrimaryTag);

    const reason = qualifies
      ? `Matched ${tags.length} research tag(s): ${tags.join(', ')}`
      : tags.length > 0
        ? `Weak match only (tags: ${tags.join(', ')}) in body text; discipline unclear — skipped`
        : 'No research-tag match';

    return { tags, tier1Count: tier1.length, tier2Count: tier2.length, qualifies, reason };
  }
}
