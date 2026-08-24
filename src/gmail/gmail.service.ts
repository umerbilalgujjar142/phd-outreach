import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import MailComposer = require('nodemailer/lib/mail-composer');
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];
const TOKEN_FILE = join(process.cwd(), '.gmail-token.json');

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; path: string }[];
  /** Set to keep a follow-up in the same Gmail conversation. */
  threadId?: string;
  /** RFC Message-ID of the message being replied to (for proper threading). */
  inReplyTo?: string;
}

export interface SentMail {
  gmailMessageId: string;
  gmailThreadId: string;
}

/**
 * Thin wrapper over the Gmail API (PROJECT.md Sections 8/10). OAuth2 "Desktop
 * app" flow: connect once via the browser, capture the refresh token, reuse it
 * forever. The refresh token is loaded from GMAIL_REFRESH_TOKEN or a local
 * .gmail-token.json (gitignored), whichever is present.
 */
@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly oauth: InstanceType<typeof google.auth.OAuth2>;
  private readonly sender: string;

  constructor(private readonly config: ConfigService) {
    this.oauth = new google.auth.OAuth2(
      this.config.get<string>('GMAIL_CLIENT_ID'),
      this.config.get<string>('GMAIL_CLIENT_SECRET'),
      this.config.get<string>('GMAIL_REDIRECT_URI') ??
        'http://localhost:5000/oauth2/callback',
    );
    this.sender = this.config.get<string>('GMAIL_SENDER') ?? '';

    const refresh = this.loadRefreshToken();
    if (refresh) {
      this.oauth.setCredentials({ refresh_token: refresh });
      this.logger.log('Gmail: refresh token loaded — ready to send.');
    } else {
      this.logger.warn('Gmail: no refresh token yet. Visit /gmail/connect to authorize.');
    }
  }

  /** True once we have a refresh token (i.e. sending is possible). */
  isConnected(): boolean {
    return !!this.oauth.credentials.refresh_token;
  }

  get senderAddress(): string {
    return this.sender;
  }

  /** Consent URL to open in the browser (asks for offline access + refresh token). */
  getAuthUrl(): string {
    return this.oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
  }

  /** Exchange the ?code= from the OAuth callback and persist the refresh token. */
  async handleCallback(code: string): Promise<{ savedRefreshToken: boolean }> {
    const { tokens } = await this.oauth.getToken(code);
    this.oauth.setCredentials(tokens);
    if (tokens.refresh_token) {
      this.saveRefreshToken(tokens.refresh_token);
      this.logger.log('Gmail: refresh token captured and saved.');
      return { savedRefreshToken: true };
    }
    // Google only returns a refresh token on the first consent; force re-consent
    // (prompt=consent) guards against this, but log if it still happens.
    this.logger.warn('Gmail: callback succeeded but no refresh token returned.');
    return { savedRefreshToken: false };
  }

  /** Build a MIME message and send it via the Gmail API. */
  async send(mail: OutgoingMail): Promise<SentMail> {
    if (!this.isConnected()) {
      throw new Error('Gmail not connected — authorize at /gmail/connect first.');
    }
    if (!this.sender) throw new Error('GMAIL_SENDER is not set in .env');

    const raw = await this.buildRaw(mail);
    const gmail = google.gmail({ version: 'v1', auth: this.oauth as any });
    const requestBody: { raw: string; threadId?: string } = { raw };
    if (mail.threadId) requestBody.threadId = mail.threadId;
    const res = await gmail.users.messages.send({ userId: 'me', requestBody });
    return {
      gmailMessageId: res.data.id ?? '',
      gmailThreadId: res.data.threadId ?? '',
    };
  }

  /**
   * Step 8: has anyone OTHER than us posted a GENUINE reply in this thread?
   * Vacation/out-of-office auto-responders are explicitly ignored — otherwise a
   * professor's "I'm on holidays, resend on the 10th" bounce would be mistaken
   * for a real reply and permanently cancel our follow-up. Read-only.
   */
  async threadHasReply(threadId: string): Promise<boolean> {
    const gmail = google.gmail({ version: 'v1', auth: this.oauth as any });
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: [
        'From',
        'Auto-Submitted',
        'X-Autoreply',
        'X-Autorespond',
        'X-Auto-Response-Suppress',
        'Precedence',
        'Subject',
      ],
    });
    const sender = this.sender.toLowerCase();
    return (res.data.messages ?? []).some((m) => {
      const headers = m.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      const from = get('From').toLowerCase();
      if (!from || from.includes(sender)) return false; // our own outgoing message
      if (GmailService.isAutoReply(get)) return false; // vacation/OOO — not a real reply
      return true;
    });
  }

  /**
   * Detect vacation/out-of-office/auto-responder messages via RFC 3834's
   * `Auto-Submitted` header plus common vendor headers (Exchange, cPanel, etc.)
   * and a multilingual subject fallback. `get` reads a header case-insensitively.
   */
  private static isAutoReply(get: (name: string) => string): boolean {
    const autoSubmitted = get('Auto-Submitted').toLowerCase();
    if (autoSubmitted && autoSubmitted !== 'no') return true; // auto-replied / auto-generated
    if (get('X-Autoreply') || get('X-Autorespond') || get('X-Auto-Response-Suppress'))
      return true;
    const precedence = get('Precedence').toLowerCase();
    if (['auto_reply', 'bulk', 'junk'].includes(precedence)) return true;
    const subject = get('Subject').toLowerCase().trim();
    return /^(automatic reply|auto ?reply|autoreply|auto:|out of office|out-of-office|away from|on (holiday|vacation|leave)|abwesenheit|automatische antwort|r[ée]ponse automatique|risposta automatica|respuesta autom[aá]tica)/.test(
      subject,
    );
  }

  /**
   * Read the most recent one-time code / verification link from the inbox — for
   * email-verification steps during job-application logins. Read-only; scans
   * only very recent mail (default last 15 min) matching verification language.
   */
  async readLatestOtp(opts?: {
    withinMinutes?: number;
    query?: string;
  }): Promise<{ code?: string; link?: string; subject: string; from: string } | null> {
    if (!this.isConnected()) throw new Error('Gmail not connected — authorize at /gmail/connect first.');
    const gmail = google.gmail({ version: 'v1', auth: this.oauth as any });
    const mins = Math.max(1, opts?.withinMinutes ?? 15);
    const q =
      opts?.query ??
      `newer_than:${mins}m (code OR verify OR verification OR otp OR "one-time" OR confirm OR passcode OR pin)`;
    try {
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 8 });
      for (const m of list.data.messages ?? []) {
        if (!m.id) continue;
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const headers = full.data.payload?.headers ?? [];
        const get = (n: string) =>
          headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? '';
        const body = this.extractText(full.data.payload);
        const text = `${get('Subject')}\n${body}`;
        const code = this.findOtpCode(text);
        const link = this.findVerifyLink(body);
        if (code || link) {
          return { code, link, subject: get('Subject'), from: get('From') };
        }
      }
      return null;
    } catch (err) {
      this.logger.warn(`OTP read failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Decode the text/plain (or html→text) body from a Gmail payload tree. */
  private extractText(payload: any): string {
    if (!payload) return '';
    const decode = (data?: string) =>
      data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
    const walk = (part: any): string => {
      if (!part) return '';
      if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
      if (part.parts) return part.parts.map(walk).join('\n');
      if (part.mimeType === 'text/html' && part.body?.data)
        return decode(part.body.data).replace(/<[^>]+>/g, ' ');
      return '';
    };
    return walk(payload).replace(/\s+/g, ' ').trim();
  }

  /** Extract a 4–8 digit one-time code, preferring one next to code/OTP wording. */
  private findOtpCode(text: string): string | undefined {
    const near = text.match(/(?:code|otp|passcode|pin|verification)[^\d]{0,24}(\d{4,8})/i);
    if (near) return near[1];
    const standalone = text.match(/\b(\d{6})\b/);
    return standalone?.[1];
  }

  /** Extract a verification/confirmation URL from the body. */
  private findVerifyLink(text: string): string | undefined {
    const m = text.match(/https?:\/\/[^\s"'<>]*(verify|confirm|activate|validation|token)[^\s"'<>]*/i);
    return m?.[0];
  }

  /** RFC 822 Message-ID header of a sent message (for In-Reply-To threading). */
  async getRfcMessageId(gmailMessageId: string): Promise<string | undefined> {
    const gmail = google.gmail({ version: 'v1', auth: this.oauth as any });
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID'],
    });
    return res.data.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === 'message-id',
    )?.value ?? undefined;
  }

  /** Compile RFC-822 MIME (with attachments) into base64url for the API. */
  private async buildRaw(mail: OutgoingMail): Promise<string> {
    const composer = new MailComposer({
      from: this.sender,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments,
      inReplyTo: mail.inReplyTo,
      references: mail.inReplyTo,
    });
    const message = await composer.compile().build();
    return message
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private loadRefreshToken(): string | null {
    const fromEnv = this.config.get<string>('GMAIL_REFRESH_TOKEN');
    if (fromEnv) return fromEnv;
    if (existsSync(TOKEN_FILE)) {
      try {
        return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).refresh_token ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private saveRefreshToken(token: string): void {
    writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: token }, null, 2));
  }
}
