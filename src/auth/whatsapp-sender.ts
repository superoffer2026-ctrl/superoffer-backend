import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Where the mock sender leaves codes for a developer to read. Never written to
 *  by a real provider, and git-ignored. */
const DEV_OTP_LOG = path.resolve(process.cwd(), '.dev-otp.log');

export const WHATSAPP_SENDER = 'WHATSAPP_SENDER';

export interface WhatsAppSender {
  sendOtp(phone: string, code: string): Promise<{ provider: string; messageId?: string }>;
}

export class MockWhatsAppSender implements WhatsAppSender {
  readonly sentMessages: { phone: string; code: string; sentAt: string }[] = [];

  async sendOtp(phone: string, code: string) {
    const sentAt = new Date().toISOString();
    this.sentMessages.push({ phone, code, sentAt });
    // Mock sender only — the code is deliberately never logged by a real provider.
    console.info(JSON.stringify({ level: 'info', event: 'whatsapp_otp_sent_mock', phone, code, timestamp: sentAt }));
    /**
     * Also appended to a file. Console output scrolls away, and is lost entirely
     * when the API runs in the background, which leaves signup untestable until
     * a real provider is connected. `npm run otp` reads the last few lines.
     */
    try {
      fs.appendFileSync(DEV_OTP_LOG, `${sentAt}  ${phone}  ${code}\n`);
    } catch {
      /* best effort — never break a send over a log */
    }
    return { provider: 'mock', messageId: crypto.randomUUID() };
  }
}

export interface MetaWhatsAppSenderConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  templateName?: string;
  languageCode?: string;
}

export class MetaWhatsAppSender implements WhatsAppSender {
  constructor(private readonly config: MetaWhatsAppSenderConfig) {
    if (!config.accessToken || !config.phoneNumberId) {
      throw new Error('Meta WhatsApp sender requires an accessToken and phoneNumberId');
    }
  }

  async sendOtp(phone: string, code: string) {
    const { accessToken, phoneNumberId, apiVersion = 'v20.0', templateName = 'otp_login', languageCode = 'en_US' } = this.config;
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }]
        }
      })
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'WhatsApp message failed to send');
    }
    return { provider: 'meta', messageId: payload?.messages?.[0]?.id };
  }
}

/**
 * Gallabox — the provider SuperOffer sends student OTPs through.
 *
 * Everything the integration needs is configuration, so switching the mock for
 * live delivery is a matter of filling in four environment variables and
 * restarting: no call site changes, because every sender is this one interface.
 * The request body below follows Gallabox's WhatsApp template message API; if
 * their contract differs from what is coded here, `buildPayload` is the single
 * place to correct.
 */
export interface GallaboxWhatsAppSenderConfig {
  apiKey: string;
  apiSecret: string;
  channelId: string;
  /** The approved WhatsApp template whose body takes the code as its one variable. */
  templateName?: string;
  baseUrl?: string;
  /** Named placeholder the template expects, e.g. `{{otp}}`. */
  bodyVariableName?: string;
}

export class GallaboxWhatsAppSender implements WhatsAppSender {
  constructor(private readonly config: GallaboxWhatsAppSenderConfig) {
    if (!config.apiKey || !config.apiSecret || !config.channelId) {
      throw new Error('Gallabox sender requires apiKey, apiSecret and channelId');
    }
  }

  private buildPayload(phone: string, code: string) {
    const { channelId, templateName = 'otp_login', bodyVariableName = 'otp' } = this.config;
    return {
      channelId,
      channelType: 'whatsapp',
      /** Gallabox expects the number without a leading `+`. */
      recipient: { phone: phone.replace(/^\+/, '') },
      whatsapp: {
        type: 'template',
        template: {
          templateName,
          bodyValues: { [bodyVariableName]: code }
        }
      }
    };
  }

  async sendOtp(phone: string, code: string) {
    const { apiKey, apiSecret, baseUrl = 'https://server.gallabox.com' } = this.config;
    const response = await fetch(`${baseUrl}/devapi/messages/whatsapp`, {
      method: 'POST',
      headers: { apiKey, apiSecret, 'content-type': 'application/json' },
      body: JSON.stringify(this.buildPayload(phone, code))
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      /** The code is never included in the error — it would land in the logs. */
      throw new Error(payload?.message || payload?.error || 'WhatsApp message failed to send');
    }
    return { provider: 'gallabox', messageId: payload?.id || payload?.messageId };
  }
}
