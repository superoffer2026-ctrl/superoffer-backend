import { Logger } from '@nestjs/common';
import { ChannelProvider, OutboundMessage, Recipient, SendResult } from './channel.providers';

/**
 * Twilio, for SMS and for WhatsApp.
 *
 * One account can carry both, so the credentials are shared and only the
 * sending number differs — an SMS long code or messaging service for one, a
 * WhatsApp-enabled number for the other.
 *
 * Both go through the same REST call, which is form-encoded and authenticated
 * with basic auth rather than a bearer token. That is Twilio's shape, not a
 * simplification: `Messages.json` takes `To`, `From` and either a `Body` or a
 * `ContentSid` naming a pre-approved template.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** An E.164 number. Ignored when a messaging service is configured. */
  from?: string;
  /**
   * A Messaging Service groups senders and carries the DLT registration for
   * India. Preferred over a bare `from` where one exists, because Twilio then
   * picks the compliant sender itself.
   */
  messagingServiceSid?: string;
}

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/** Shared by both channels: the same endpoint, the same auth, different sender. */
async function postMessage(
  config: TwilioConfig,
  fields: Record<string, string>
): Promise<SendResult> {
  const body = new URLSearchParams(fields);
  if (config.messagingServiceSid) {
    body.set('MessagingServiceSid', config.messagingServiceSid);
  } else if (config.from) {
    body.set('From', config.from);
  } else {
    throw new Error('Twilio needs either a sending number or a messaging service');
  }

  const response = await fetch(`${TWILIO_API}/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await response.text();
  if (!response.ok) {
    /*
     * Twilio explains itself in the body, and the reason is usually actionable
     * — an unregistered template, a number that has opted out, a sender that
     * cannot reach that country. Carrying it into the delivery row means an
     * operator can read it without opening a dashboard.
     */
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: number };
      if (parsed.message) detail = `${parsed.message}${parsed.code ? ` (${parsed.code})` : ''}`;
    } catch {
      /* Not JSON; the raw body is still the best thing to record. */
    }
    throw new Error(`Twilio refused the message (${response.status}): ${detail}`);
  }

  const result = JSON.parse(text) as { sid?: string };
  return { provider: 'twilio', providerMessageId: result.sid };
}

// ── SMS ─────────────────────────────────────────────────────────────────────

export class TwilioSmsChannel implements ChannelProvider {
  readonly key = 'sms' as const;

  constructor(private readonly config: TwilioConfig) {}

  available(): boolean {
    return !!this.config.accountSid && !!this.config.authToken
      && !!(this.config.from || this.config.messagingServiceSid);
  }

  addressOf(to: Recipient): string | null {
    return to.phone;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = message.to.phone;
    if (!to) throw new Error('No mobile number on the account');

    /*
     * The rendered template, not the typed body.
     *
     * An Indian operator matches the text against what was registered on DLT;
     * anything else is rejected outright. Sending the body would look like it
     * worked here and fail silently at the carrier.
     */
    const template = message.template;
    if (!template?.name) {
      throw new Error('SMS needs a DLT-registered template');
    }

    return postMessage(this.config, { To: to, Body: renderTemplate(template.name, template.params) });
  }
}

/**
 * Fills a registered template with its values, in order.
 *
 * DLT templates are registered with `{#var#}` placeholders, so the stored
 * template text is what was approved and the params are what go into it.
 */
function renderTemplate(text: string, params: string[]): string {
  let index = 0;
  return text.replace(/\{#var#\}/g, () => params[index++] ?? '');
}

// ── WhatsApp, through Twilio rather than Meta directly ──────────────────────

export class TwilioWhatsAppChannel implements ChannelProvider {
  readonly key = 'whatsapp' as const;

  constructor(private readonly config: TwilioConfig) {}

  available(): boolean {
    return !!this.config.accountSid && !!this.config.authToken
      && !!(this.config.from || this.config.messagingServiceSid);
  }

  addressOf(to: Recipient): string | null {
    return to.phone;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = message.to.phone;
    if (!to) throw new Error('No mobile number on the account');
    if (!message.template?.name) {
      throw new Error('WhatsApp needs an approved template outside the service window');
    }

    /*
     * Twilio addresses WhatsApp with a `whatsapp:` prefix on both ends, and
     * names an approved template by its Content SID rather than by a name.
     * The variables are a JSON object keyed by position — "1", "2" — which is
     * how Twilio's content API expects them.
     */
    const variables = Object.fromEntries(
      (message.template.params || []).map((value, index) => [String(index + 1), value])
    );

    const config = {
      ...this.config,
      from: this.config.from ? withPrefix(this.config.from) : undefined
    };

    return postMessage(config, {
      To: withPrefix(to),
      ContentSid: message.template.name,
      ContentVariables: JSON.stringify(variables)
    });
  }
}

const withPrefix = (number: string) =>
  number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;

// ── A logging SMS channel, for anywhere that is not configured ──────────────

export class ConsoleSmsChannel implements ChannelProvider {
  readonly key = 'sms' as const;
  private readonly logger = new Logger('SmsChannel');
  readonly sent: Array<{ to: string; body: string; at: string }> = [];

  available(): boolean {
    return true;
  }

  addressOf(to: Recipient): string | null {
    return to.phone;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const at = new Date().toISOString();
    const text = message.template?.name
      ? renderTemplate(message.template.name, message.template.params || [])
      : message.body;
    this.sent.push({ to: message.to.phone || '', body: text, at });
    this.logger.log(`[mock] to=${message.to.phone} "${text.slice(0, 60)}"`);
    return { provider: 'mock', providerMessageId: `mock-sms-${this.sent.length}` };
  }
}

/** Read once, so the choice of provider is visible in one place. */
export function twilioFrom(env: NodeJS.ProcessEnv): TwilioConfig | null {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_SMS_FROM,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID
  };
}
