import { RoleType } from '../job-status.enum';

/** A software-development role at all (gate: reject non-engineering postings). */
export const DEV_ROLE_RE =
  /(developer|engineer|programmer|full[\s-]?stack|back[\s-]?end|front[\s-]?end|software|web dev|sde|node|react)/i;

/** Role-family signals used to pick the base CV. */
export const ROLE_SIGNALS: { role: RoleType; re: RegExp; weight: number }[] = [
  { role: RoleType.MOBILE, re: /react native|\bios\b|android|mobile (app|developer|engineer)|flutter|swift|kotlin/i, weight: 3 },
  { role: RoleType.FULLSTACK, re: /full[\s-]?stack|front[\s-]?end and back|mern|react.*node|node.*react/i, weight: 3 },
  { role: RoleType.BACKEND, re: /back[\s-]?end|micro[\s-]?service|rest api|server[\s-]?side|api developer|nest\.?js|node\.?js/i, weight: 2 },
];

/**
 * Primary non-JS stacks that are NOT Umer's skill set. A role built around one
 * of these is disqualified (unless it's clearly a JS/React/Node role too) —
 * keeps the pipeline off Python/.NET/Flask/Java/PHP/Go/Ruby/Rust jobs.
 */
export const FOREIGN_STACK_RE =
  /\b(java|jakarta|\.net|c#|dotnet|php|laravel|symfony|ruby on rails|\brails\b|ruby|golang|\bgo developer|scala|rust|c\+\+|python|flask|django|fastapi|spring ?boot|spring|perl|elixir|kotlin backend)\b/i;

/** Umer's actual core stack — JS/TS, React family, Node family. */
export const JS_STACK_RE =
  /(node\.?js|nest\.?js|express\.?js|react\s?native|react\.?js|\breact\b|next\.?js|typescript|javascript|\bts\b|\bjs\b|mern|full[\s-]?stack)/i;

/** Words that strongly indicate a remote posting. */
export const REMOTE_RE = /\bremote\b|work from home|wfh|fully distributed|anywhere/i;
