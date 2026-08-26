import { Injectable, Logger } from '@nestjs/common';
import { ChannelKey, ChannelTemplate } from './automation.types';
import {
  ConsoleSmsChannel,
  TwilioSmsChannel,
  TwilioWhatsAppChannel,
  twilioFrom
} from './twilio.providers';

/**
 * Sending, per channel.
 *
 * The in-app thread is written by the service itself because it is a row in our
 * own database and belongs in the same transaction as the read flags. Everything
 * else leaves the building through one of these, so the dispatcher never learns
 * what an access token or an SMTP host is.
 */

export interface Recipient {
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface OutboundMessage {
  to: Recipient;
  /** The rendered body. WhatsApp ignores it when a template is given. */
  body: string;
  subject: string;
  template?: ChannelTemplate;
}

export interface SendResult {
  providerMessageId?: string;
  provider: string;
}

export interface ChannelProvider {
  readonly key: ChannelKey;
  /** False when nothing is configured, so the caller records a skip not a failure. */
  available(): boolean;
  /** The address this channel would use, or null when the person has none. */
  addressOf(to: Recipient): string | null;
  send(message: OutboundMessage): Promise<SendResult>;
}

// ── Email ───────────────────────────────────────────────────────────────────

/**
 * Logs instead of sending.
 *
 * Deliberately the default: an unconfigured environment that quietly posts real
 * mail to real students is worse than one that sends nothing, and every driver
 * and test run in this repo would otherwise be writing to strangers.
 */
export class ConsoleEmailProvider implements ChannelProvider {
  readonly key = 'email' as const;
  private readonly logger = new Logger('EmailChannel');
  readonly sent: Array<{ to: string; subject: string; body: string; at: string }> = [];

  available(): boolean {
    return true;
  }

  addressOf(to: Recipient): string | null {
    return to.email;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const at = new Date().toISOString();
    this.sent.push({ to: message.to.email || '', subject: message.subject, body: message.body, at });
    this.logger.log(`[mock] to=${message.to.email} subject=${message.subject}`);
    return { provider: 'console', providerMessageId: `console-${this.sent.length}` };
  }
}

export interface SmtpEmailConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Real mail, over SMTP.
 *
 * Kept behind the same interface as the console one so switching is a matter of
 * configuration rather than a code path, and so nothing above here has to know
 * which is in use.
 */
export class SmtpEmailProvider implements ChannelProvider {
  readonly key = 'email' as const;
  private readonly logger = new Logger('EmailChannel');

  constructor(private readonly config: SmtpEmailConfig) {}

  available(): boolean {
    return !!this.config.host && !!this.config.from;
  }

  addressOf(to: Recipient): string | null {
    return to.email;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    /*
     * Left as the one place a mail library gets wired in. Throwing rather than
     * pretending means a half-configured environment shows up as a FAILED
     * delivery row with a reason, which is the outcome we want it to have.
     */
    throw new Error(
      'SMTP email provider is configured but no transport is wired in yet; unset MAIL_HOST to use the console provider.'
    );
  }
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

export class MockWhatsAppChannel implements ChannelProvider {
  readonly key = 'whatsapp' as const;
  private readonly logger = new Logger('WhatsAppChannel');
  readonly sent: Array<{ to: string; template: string; params: string[]; at: string }> = [];

  available(): boolean {
    return true;
  }

  addressOf(to: Recipient): string | null {
    return to.phone;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const at = new Date().toISOString();
    const template = message.template?.name || '(none)';
    this.sent.push({ to: message.to.phone || '', template, params: message.template?.params || [], at });
    this.logger.log(`[mock] to=${message.to.phone} template=${template}`);
    return { provider: 'mock', providerMessageId: `mock-wa-${this.sent.length}` };
  }
}

export interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  languageCode?: string;
}

/**
 * Meta's WhatsApp Business Platform.
 *
 * Templates rather than free text, because outside a 24-hour window opened by
 * the student writing to us first, that is the only thing Meta will deliver.
 * The body we rendered is still passed along for the delivery record, but what
 * actually goes out is the registered template and its parameters in order.
 */
export class MetaWhatsAppChannel implements ChannelProvider {
  readonly key = 'whatsapp' as const;

  constructor(private readonly config: MetaWhatsAppConfig) {}

  available(): boolean {
    return !!this.config.accessToken && !!this.config.phoneNumberId;
  }

  addressOf(to: Recipient): string | null {
    return to.phone;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!message.template?.name) {
      throw new Error('WhatsApp needs an approved template name outside the service window');
    }
    const { accessToken, phoneNumberId, apiVersion = 'v20.0', languageCode = 'en_US' } = this.config;
    const to = (message.to.phone || '').replace(/^\+/, '');
    if (!to) throw new Error('No mobile number on the account');

    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: message.template.name,
          language: { code: languageCode },
          components: [
            {
              type: 'body',
              parameters: message.template.params.map(text => ({ type: 'text', text }))
            }
          ]
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`WhatsApp refused the message (${response.status}): ${detail.slice(0, 300)}`);
    }
    const result = (await response.json()) as { messages?: Array<{ id: string }> };
    return { provider: 'meta', providerMessageId: result.messages?.[0]?.id };
  }
}

// ── Registry ────────────────────────────────────────────────────────────────

export const CHANNEL_PROVIDERS = 'CHANNEL_PROVIDERS';

/**
 * Which provider answers for which channel.
 *
 * `inapp` is absent on purpose — the thread is ours to write, not a provider's
 * to send to, and the service handles it directly.
 */
@Injectable()
export class ChannelRegistry {
  private readonly providers = new Map<ChannelKey, ChannelProvider>();

  constructor(providers: ChannelProvider[]) {
    for (const provider of providers) this.providers.set(provider.key, provider);
  }

  get(channel: ChannelKey): ChannelProvider | undefined {
    return this.providers.get(channel);
  }

  /** What the admin panel shows beside each channel. */
  status(): Array<{ channel: ChannelKey; configured: boolean; provider: string }> {
    return [
      { channel: 'inapp' as ChannelKey, configured: true, provider: 'built in' },
      ...[...this.providers.values()].map(provider => ({
        channel: provider.key,
        configured: provider.available(),
        provider: provider.constructor.name.replace(/Provider|Channel$/g, '')
      }))
    ];
  }
}

/**
 * Built from the environment, the same way the login OTP sender already is.
 *
 * Every channel resolves to a real provider when it has credentials and to a
 * logging one when it does not, so a half-configured environment writes to the
 * log rather than to a student. The order of preference is stated once here
 * rather than being inferred from whichever variable happens to be set.
 */
export function buildChannelProviders(env: NodeJS.ProcessEnv): ChannelProvider[] {
  const providers: ChannelProvider[] = [];
  const twilio = twilioFrom(env);

  providers.push(
    env.MAIL_HOST
      ? new SmtpEmailProvider({
          host: env.MAIL_HOST,
          port: Number(env.MAIL_PORT || 587),
          user: env.MAIL_USER,
          pass: env.MAIL_PASSWORD,
          from: env.MAIL_FROM || 'no-reply@superoffer.example'
        })
      : new ConsoleEmailProvider()
  );

  /*
   * WhatsApp can come from Meta directly or through Twilio as the business
   * provider. Meta wins when both are configured: it is one hop fewer, and the
   * templates are named rather than referenced by a Content SID.
   */
  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    providers.push(new MetaWhatsAppChannel({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: env.WHATSAPP_API_VERSION,
      languageCode: env.WHATSAPP_TEMPLATE_LANGUAGE
    }));
  } else if (twilio && (env.TWILIO_WHATSAPP_FROM || twilio.messagingServiceSid)) {
    providers.push(new TwilioWhatsAppChannel({
      ...twilio,
      from: env.TWILIO_WHATSAPP_FROM
    }));
  } else {
    providers.push(new MockWhatsAppChannel());
  }

  /* SMS has only one real provider today. */
  providers.push(
    twilio && (twilio.from || twilio.messagingServiceSid)
      ? new TwilioSmsChannel(twilio)
      : new ConsoleSmsChannel()
  );

  return providers;
}
