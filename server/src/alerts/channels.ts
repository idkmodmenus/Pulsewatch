import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { runHttpCheck } from '../checks/http.js';

export type AlertPayload = {
  eventType: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  url?: string;
  fields: { label: string; value: string }[];
  occurredAt: string;
};

export interface NotificationChannel {
  readonly type: string;
  send(payloadConfig: Record<string, any>, payload: AlertPayload): Promise<void>;
}

const COLORS = { critical: 0xe0483d, warning: 0xd9a441, info: 0x3fa7a0 };

/**
 * Outbound webhooks are user-supplied URLs, so they go through the same guard as monitored
 * targets: validated, pinned to a vetted address, size-limited.
 */
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const result = await runHttpCheck(
    {
      url,
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      expectedStatus: ['2xx', '3xx'],
      followRedirects: false
    },
    10_000
  );
  if (!result.ok) throw new Error(result.error ?? 'webhook delivery failed');
}

const discord: NotificationChannel = {
  type: 'discord',
  async send(cfg, payload) {
    if (!cfg.webhookUrl) throw new Error('This Discord channel has no webhook URL.');
    await postJson(cfg.webhookUrl, {
      username: 'Pulsewatch',
      embeds: [
        {
          title: payload.title,
          description: payload.message,
          url: payload.url,
          color: COLORS[payload.severity],
          timestamp: payload.occurredAt,
          fields: payload.fields.map((f) => ({ name: f.label, value: f.value, inline: true }))
        }
      ]
    });
  }
};

const slack: NotificationChannel = {
  type: 'slack',
  async send(cfg, payload) {
    if (!cfg.webhookUrl) throw new Error('This Slack channel has no webhook URL.');
    await postJson(cfg.webhookUrl, {
      text: `${payload.title} — ${payload.message}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${payload.title}*\n${payload.message}` } },
        ...(payload.fields.length
          ? [{
              type: 'section',
              fields: payload.fields.map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` }))
            }]
          : [])
      ]
    });
  }
};

const webhook: NotificationChannel = {
  type: 'webhook',
  async send(cfg, payload) {
    if (!cfg.url) throw new Error('This webhook has no URL.');
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
    if (cfg.secret) {
      headers['x-pulsewatch-signature'] =
        'sha256=' + createHmac('sha256', String(cfg.secret)).update(body).digest('hex');
    }
    await postJson(cfg.url, payload, headers);
  }
};

const email: NotificationChannel = {
  type: 'email',
  async send(cfg, payload) {
    if (!cfg.to) throw new Error('This email channel has no recipient.');
    if (!config.SMTP_URL) throw new Error('No SMTP server is configured, so email cannot be delivered.');
    const transport = nodemailer.createTransport(config.SMTP_URL);
    const lines = payload.fields.map((f) => `${f.label}: ${f.value}`).join('\n');
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: String(cfg.to),
      subject: payload.title,
      text: `${payload.message}\n\n${lines}\n\n${payload.url ?? ''}`.trim()
    });
  }
};

const channels = new Map<string, NotificationChannel>(
  [email, discord, slack, webhook].map((c) => [c.type, c])
);

export const channelTypes = [...channels.keys()];

export function getChannel(type: string): NotificationChannel {
  const channel = channels.get(type);
  if (!channel) throw new Error(`Unknown notification channel "${type}".`);
  return channel;
}
