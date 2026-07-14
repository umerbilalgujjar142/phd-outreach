import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium, Page } from 'playwright';

/**
 * Shared headless Chromium for JS-rendered sites (university faculty pages).
 * Lazily launched, reused across crawls, closed on shutdown.
 */
@Injectable()
export class PlaywrightService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser?: Browser;

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

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => undefined);
  }
}
