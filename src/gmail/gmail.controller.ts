import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GmailService } from './gmail.service';

/**
 * One-time OAuth flow (PROJECT.md Section 10). Open /gmail/connect in a browser,
 * approve, and Google redirects to /oauth2/callback which captures the refresh
 * token. /gmail/status reports whether we're ready to send.
 */
@Controller()
export class GmailController {
  constructor(private readonly gmail: GmailService) {}

  @Get('gmail/status')
  status() {
    return { connected: this.gmail.isConnected(), sender: this.gmail.senderAddress };
  }

  @Get('gmail/connect')
  connect(@Res() res: Response) {
    return res.redirect(this.gmail.getAuthUrl());
  }

  @Get('oauth2/callback')
  async callback(@Query('code') code: string, @Query('error') error: string) {
    if (error) return { ok: false, error };
    if (!code) return { ok: false, error: 'missing ?code' };
    const result = await this.gmail.handleCallback(code);
    return {
      ok: true,
      ...result,
      message: result.savedRefreshToken
        ? 'Gmail connected. You can close this tab and return to the app.'
        : 'Authorized, but no refresh token returned — revoke access and retry /gmail/connect.',
    };
  }
}
