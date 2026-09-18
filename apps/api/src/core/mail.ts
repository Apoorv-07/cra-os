import { env } from '../env.js';
import { log } from './logger.js';

/**
 * Transactional mail.
 *
 * `console` is the default so a clean clone never needs credentials: messages
 * are logged instead of sent. Switch to `resend` with RESEND_API_KEY in any
 * environment where you need real delivery.
 */

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
  driver: string;
  id?: string | null;
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (env.MAIL_DRIVER === 'none') {
    log.debug('mail suppressed', { to: input.to, subject: input.subject });
    return { delivered: false, driver: 'none' };
  }

  if (env.MAIL_DRIVER === 'resend') {
    if (!env.RESEND_API_KEY) {
      log.warn('resend selected but RESEND_API_KEY is missing; falling back to console');
      return consoleDriver(input);
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
      });

      if (!res.ok) {
        log.error('resend send failed', { status: res.status, body: (await res.text()).slice(0, 200) });
        return { delivered: false, driver: 'resend' };
      }

      const json = (await res.json()) as { id?: string };
      return { delivered: true, driver: 'resend', id: json.id ?? null };
    } catch (err) {
      log.error('resend request threw', { error: err instanceof Error ? err.message : String(err) });
      return { delivered: false, driver: 'resend' };
    }
  }

  return consoleDriver(input);
}

function consoleDriver(input: MailInput): MailResult {
  log.info('mail (console driver)', {
    to: input.to,
    subject: input.subject,
    preview: input.text.slice(0, 160),
  });
  return { delivered: true, driver: 'console' };
}
