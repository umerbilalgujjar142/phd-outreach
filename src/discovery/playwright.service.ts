import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { Browser, BrowserContext, chromium, Page } from 'playwright';

const INTERACTIVE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/**
 * Shared headless Chromium for JS-rendered sites (university faculty pages).
 * Lazily launched, reused across crawls, closed on shutdown.
 */
@Injectable()
export class PlaywrightService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser?: Browser;
  private interactiveBrowser?: Browser;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      this.logger.log('Chromium launched');
    }
    return this.browser;
  }

  /** Open `url`, run `fn(page)`, always close the page/context afterwards. */
  async withPage<T>(url: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    // Skip heavy assets to speed crawling.
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return await fn(page);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Open a page whose lifecycle the CALLER controls — used by the assisted-apply
   * flow, which fills a form, then holds the page open across a human review gap
   * before submitting. Unlike `withPage`, nothing is aborted (we need a faithful
   * screenshot) and the context is NOT auto-closed; the caller must close it.
   * Headful by default so the user can watch the fill and take over blocked
   * steps (login/CAPTCHA) in the same window.
   */
  /**
   * Visit `warmup` URLs (same-origin homepage/listing pages) before the target so
   * a bot manager's sensor JS runs and validates the session. Some boards
   * (IrishJobs = Akamai) reset/stall a COLD request straight to a protected
   * job/apply URL, but let it through once the session is warm. Tolerant: a slow
   * warm-up hop never aborts the flow.
   */
  private async warmUp(page: Page, warmup: string[]): Promise<void> {
    for (const w of warmup) {
      await page.goto(w, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(3000);
    }
  }

  async openSession(
    url: string,
    opts: { headful?: boolean; warmup?: string[] } = {},
  ): Promise<{ context: BrowserContext; page: Page }> {
    const headful = opts.headful ?? true;
    const warmup = opts.warmup ?? [];

    // Persistent-profile mode (JOB_BROWSER_PROFILE=<dir>): reuse a real on-disk
    // Chromium profile so cookies, an existing login, AND any bot-manager
    // validation (e.g. IrishJobs' Akamai `_abck` sensor cookie) PERSIST between
    // runs. Solve the login / bot challenge ONCE by hand in the opened window and
    // every later apply reuses it — the only reliable way past Akamai/DataDome
    // bot walls, which reset fresh automated sessions on protected URLs.
    const profileDir = process.env.JOB_BROWSER_PROFILE;
    if (profileDir) {
      const dir = resolve(profileDir);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const context = await chromium.launchPersistentContext(dir, {
        headless: !headful,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        userAgent: INTERACTIVE_UA,
        locale: 'en-US',
        viewport: { width: 1280, height: 1400 },
        acceptDownloads: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      if (warmup.length) await this.warmUp(page, warmup);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      this.logger.log(`Interactive session on persistent profile ${dir} (headful=${headful})`);
      return { context, page };
    }

    // Ephemeral mode (default): a clean throwaway context each time.
    if (!this.interactiveBrowser || !this.interactiveBrowser.isConnected()) {
      this.interactiveBrowser = await chromium.launch({
        headless: !headful,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      this.logger.log(`Interactive Chromium launched (headful=${headful})`);
    }
    const context = await this.interactiveBrowser.newContext({
      userAgent: INTERACTIVE_UA,
      locale: 'en-US',
      viewport: { width: 1280, height: 1400 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    if (warmup.length) await this.warmUp(page, warmup);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return { context, page };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => undefined);
    if (this.interactiveBrowser) await this.interactiveBrowser.close().catch(() => undefined);
  }
}
