import * as crypto from 'node:crypto';

export const WHATSAPP_SENDER = 'WHATSAPP_SENDER';

export interface WhatsAppSender {
  sendOtp(phone: string, code: string): Promise<{ provider: string; messageId?: string }>;
}

export class MockWhatsAppSender implements WhatsAppSender {
  readonly sentMessages: { phone: string; code: string; sentAt: string }[] = [];

  async sendOtp(phone: string, code: string) {
    const sentAt = new Date().toISOString();
    this.sentMessages.push({ phone, code, sentAt });
    // Mock sender only — the code is deliberately never logged by the real Meta sender.
    console.info(JSON.stringify({ level: 'info', event: 'whatsapp_otp_sent_mock', phone, code, timestamp: sentAt }));
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
