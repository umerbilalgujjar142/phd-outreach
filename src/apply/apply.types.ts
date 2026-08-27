/** A single fillable control discovered on an application form. */
export interface FormField {
  /** Stable ref injected as a data-attribute so filling is deterministic. */
  ref: string;
  /** input | textarea | select. */
  tag: string;
  /** input type (text, email, tel, file, checkbox, radio…) — '' for others. */
  type: string;
  name: string;
  /** Best human label we could associate (label/aria-label/placeholder/near text). */
  label: string;
  required: boolean;
  /** For <select>: available options (value + visible text). */
  options?: { value: string; text: string }[];
}

/** What the analyzer found on the page before any filling happened. */
export interface FormAnalysis {
  fields: FormField[];
  /** Hard blockers a bot cannot cross alone (auth wall, CAPTCHA). */
  hardBlockers: string[];
  /** Soft warnings worth surfacing (e.g. login link present but optional). */
  warnings: string[];
}

/** One planned action against a field. */
export interface FillPlanItem {
  ref: string;
  label: string;
  action: 'fill' | 'select' | 'upload' | 'check' | 'skip';
  /** Text to type, option to select, or (for upload) the DOCUMENT_CATALOG key. */
  value?: string;
  reason?: string;
}

/** Outcome of executing a single plan item against the live page. */
export interface FillResult {
  ref: string;
  label: string;
  action: string;
  value?: string;
  ok: boolean;
  error?: string;
}

export interface StartApplicationResult {
  sessionId: string;
  professorId: string;
  professorName: string;
  applyUrl: string;
  status: 'pending_review' | 'needs_manual';
  /** Path to the screenshot of the filled (or blocked) form for review. */
  screenshotPath?: string;
  filled: FillResult[];
  skipped: FillResult[];
  hardBlockers: string[];
  warnings: string[];
  /** Human next-step hint. */
  message: string;
}

export interface SubmitApplicationResult {
  sessionId: string;
  professorId: string;
  ok: boolean;
  submitted: boolean;
  needsManualSubmit?: boolean;
  resultScreenshotPath?: string;
  message: string;
}
