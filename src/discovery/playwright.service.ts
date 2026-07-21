import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, BrowserContext, chromium, Page } from 'playwright';

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
  async openSession(
    url: string,
    opts: { headful?: boolean } = {},
  ): Promise<{ context: BrowserContext; page: Page }> {
    const headful = opts.headful ?? true;
    if (!this.interactiveBrowser || !this.interactiveBrowser.isConnected()) {
      this.interactiveBrowser = await chromium.launch({
        headless: !headful,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      this.logger.log(`Interactive Chromium launched (headful=${headful})`);
    }
    const context = await this.interactiveBrowser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      locale: 'en-US',
      viewport: { width: 1280, height: 1400 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return { context, page };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => undefined);
    if (this.interactiveBrowser) await this.interactiveBrowser.close().catch(() => undefined);
  }
}
