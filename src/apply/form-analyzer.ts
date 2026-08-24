import { Injectable, Logger } from '@nestjs/common';
import type { Frame, Page } from 'playwright';
import { FormAnalysis, FormField } from './apply.types';

/**
 * Inspects a live application-form page: injects a stable ref on every fillable
 * control (so later filling is deterministic), harvests a human label for each,
 * and flags hard blockers a bot must not try to cross on its own — CAPTCHAs and
 * authentication walls (account creation + email verification).
 */
@Injectable()
export class FormAnalyzer {
  private readonly logger = new Logger(FormAnalyzer.name);

  async analyze(page: Page): Promise<FormAnalysis> {
    // Give slow ATS forms a moment to render their fields.
    await page.waitForTimeout(1500);
    return this.analyzeRoot(page);
  }

  /**
   * Analyze the top page AND every iframe, returning the richest form together
   * with the root (Page or Frame) it lives in — so the caller fills in the right
   * context. Many ATS (Recruitee/Greenhouse-embed/Ashby) render the form inside
   * an iframe the top document can't see.
   */
  async analyzeBest(
    page: Page,
  ): Promise<{ analysis: FormAnalysis; root: Page | Frame }> {
    await page.waitForTimeout(1800);
    const roots: (Page | Frame)[] = [page, ...page.frames()];
    let best: { analysis: FormAnalysis; root: Page | Frame } | null = null;
    for (const root of roots) {
      const analysis = await this.analyzeRoot(root).catch(() => null);
      if (!analysis) continue;
      if (!best || analysis.fields.length > best.analysis.fields.length) {
        best = { analysis, root };
      }
    }
    const chosen =
      best ?? {
        analysis: {
          fields: [],
          hardBlockers: ['No fillable form fields found on this page.'],
          warnings: [],
        } as FormAnalysis,
        root: page as Page | Frame,
      };
    this.logger.log(
      `Analyzed ${roots.length} frame(s): best form has ${chosen.analysis.fields.length} field(s)`,
    );
    return chosen;
  }

  /** Run the field/blocker analysis inside one root (Page or Frame). */
  private async analyzeRoot(root: Page | Frame): Promise<FormAnalysis> {
    const result = await root.evaluate(() => {
      const REF_ATTR = 'data-apply-ref';

      const visible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = window.getComputedStyle(el as HTMLElement);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };

      const labelFor = (el: HTMLElement): string => {
        const id = el.getAttribute('id');
        if (id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (lbl?.textContent?.trim()) return lbl.textContent.trim();
        }
        const wrap = el.closest('label');
        if (wrap?.textContent?.trim()) return wrap.textContent.trim();
        const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')!.trim();
        if (aria) {
          const ref = document.getElementById(aria);
          if (ref?.textContent?.trim()) return ref.textContent.trim();
        }
        const ph = el.getAttribute('placeholder');
        if (ph) return ph.trim();
        // Fall back to nearest preceding text.
        const prev = el.previousElementSibling as HTMLElement | null;
        if (prev?.textContent?.trim()) return prev.textContent.trim().slice(0, 120);
        return el.getAttribute('name') || '';
      };

      const fields: {
        ref: string;
        tag: string;
        type: string;
        name: string;
        label: string;
        required: boolean;
        options?: { value: string; text: string }[];
      }[] = [];

      const controls = Array.from(
        document.querySelectorAll('input, textarea, select'),
      ) as HTMLElement[];

      let i = 0;
      let hasPassword = false;
      for (const el of controls) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'password') hasPassword = true;
        if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
        if (!visible(el)) continue;

        const ref = `f${i++}`;
        el.setAttribute(REF_ATTR, ref);
        const field: (typeof fields)[number] = {
          ref,
          tag,
          type,
          name: el.getAttribute('name') || '',
          label: labelFor(el).replace(/\s+/g, ' ').trim().slice(0, 160),
          required:
            el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        };
        if (tag === 'select') {
          field.options = Array.from((el as HTMLSelectElement).options).map((o) => ({
            value: o.value,
            text: (o.textContent || '').trim(),
          }));
        }
        fields.push(field);
      }

      // Blocker detection.
      const html = document.documentElement.innerHTML.toLowerCase();
      const bodyText = (document.body.textContent || '').toLowerCase();
      const hardBlockers: string[] = [];
      const warnings: string[] = [];

      const captcha =
        !!document.querySelector(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [data-sitekey], iframe[title*="captcha" i]',
        ) || /\bcaptcha\b/.test(bodyText);
      if (captcha) hardBlockers.push('CAPTCHA present — must be solved by a human.');

      // Auth wall: a password field with sign-in/register language and no file
      // upload usually means the real form is behind account creation.
      const hasFile = !!document.querySelector('input[type="file"]');
      const authWords = /(sign in|log in|login|create an account|register|password)/.test(
        bodyText,
      );
      if (hasPassword && authWords && !hasFile && fields.length <= 4) {
        hardBlockers.push(
          'Login / account-creation wall — the form is behind sign-in (email verification required).',
        );
      } else if (hasPassword) {
        warnings.push('Page contains a password field — an account step may be required.');
      }

      if (fields.length === 0) {
        hardBlockers.push('No fillable form fields found on this page.');
      }

      return { fields, hardBlockers, warnings };
    });

    return result as FormAnalysis;
  }
}
