import type { Page } from 'playwright';

/**
 * Per-ATS adapters. Aggregators (Arbeitnow/RemoteOK) link out to a company ATS,
 * and each ATS reveals its application form differently (Recruitee: inline
 * overlay behind an "Apply" button; Lever: a `/apply` URL; Greenhouse: fields
 * inline on the board page; Ashby: an SPA "Apply" view). Generic clicking is
 * unreliable, so each adapter knows how to reach its own form.
 *
 * `reachForm` should leave `page` showing the fillable form (best-effort). The
 * caller re-checks `looksLikeForm` afterwards and only fills if a real form is
 * present.
 */
export interface AtsAdapter {
  readonly name: string;
  matches(url: string): boolean;
  reachForm(page: Page): Promise<void>;
}

/** Wait until a plausible application field is visible (or time out quietly). */
async function waitForFields(page: Page, timeout = 12_000): Promise<void> {
  await page
    .waitForSelector(
      'input[type="file"], input[type="email"], input[type="text"], input[type="tel"], textarea',
      { timeout, state: 'visible' },
    )
    .catch(() => undefined);
}

async function clickApplyExact(page: Page): Promise<void> {
  const skipRe = /with xing|with linkedin|with indeed|share|alert|save/i;
  // Prefer an exact "Apply" / "Apply for this job" control; take the LAST match
  // (the primary CTA sits below the description, above social-apply buttons).
  for (const re of [/^apply for this job$/i, /^apply now$/i, /^apply$/i, /\bapply\b/i]) {
    const loc = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re }));
    const n = await loc.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      const c = loc.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      const t = (await c.textContent().catch(() => '')) || '';
      if (skipRe.test(t)) continue;
      await c.scrollIntoViewIfNeeded().catch(() => undefined);
      await c.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      return;
    }
  }
}

class RecruiteeAdapter implements AtsAdapter {
  readonly name = 'recruitee';
  matches(url: string): boolean {
    try {
      return new URL(url).hostname.endsWith('.recruitee.com');
    } catch {
      return false;
    }
  }
  async reachForm(page: Page): Promise<void> {
    // The form reveals inline after the primary "Apply" CTA.
    await clickApplyExact(page);
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await waitForFields(page);
  }
}

class LeverAdapter implements AtsAdapter {
  readonly name = 'lever';
  matches(url: string): boolean {
    try {
      return new URL(url).hostname === 'jobs.lever.co';
    } catch {
      return false;
    }
  }
  async reachForm(page: Page): Promise<void> {
    const url = new URL(page.url());
    if (!/\/apply\/?$/.test(url.pathname)) {
      const dest = `${url.origin}${url.pathname.replace(/\/$/, '')}/apply`;
      await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    }
    await waitForFields(page);
  }
}

class GreenhouseAdapter implements AtsAdapter {
  readonly name = 'greenhouse';
  matches(url: string): boolean {
    try {
      return /greenhouse\.io$/.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }
  async reachForm(page: Page): Promise<void> {
    // Greenhouse board pages carry the form inline; some need an "Apply" click.
    if (!(await hasFields(page))) await clickApplyExact(page);
    await page.mouse.wheel(0, 2000).catch(() => undefined);
    await waitForFields(page);
  }
}

class AshbyAdapter implements AtsAdapter {
  readonly name = 'ashby';
  matches(url: string): boolean {
    try {
      return new URL(url).hostname === 'jobs.ashbyhq.com';
    } catch {
      return false;
    }
  }
  async reachForm(page: Page): Promise<void> {
    await clickApplyExact(page); // SPA renders the form in place
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await waitForFields(page);
  }
}

async function hasFields(page: Page): Promise<boolean> {
  const n = await page
    .locator('input[type="file"], input[type="email"], input[type="text"], textarea')
    .count()
    .catch(() => 0);
  return n >= 4;
}

export const ATS_ADAPTERS: AtsAdapter[] = [
  new RecruiteeAdapter(),
  new LeverAdapter(),
  new GreenhouseAdapter(),
  new AshbyAdapter(),
];

export function adapterFor(url: string): AtsAdapter | undefined {
  return ATS_ADAPTERS.find((a) => a.matches(url));
}
