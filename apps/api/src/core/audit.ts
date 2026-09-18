import { getDb } from '../db/index.js';
import { auditLogs, systemEvents } from '../db/schema.js';
import { newId } from './ids.js';
import { log } from './logger.js';

export interface AuditInput {
  orgId?: string | null;
  actorUserId?: string | null;
  actorType?: 'user' | 'api_key' | 'system' | 'provider';
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Writes an append-only audit record.
 *
 * Audit logging must never break the request that produced it, so failures are
 * logged and swallowed — but they are always logged at `error`.
 */
export function audit(input: AuditInput): void {
  try {
    getDb()
      .insert(auditLogs)
      .values({
        id: newId('aud'),
        orgId: input.orgId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType ?? 'user',
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metaJson: input.meta === undefined ? null : JSON.stringify(input.meta),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: Date.now(),
      })
      .run();
  } catch (err) {
    log.error('audit write failed', { action: input.action, error: String(err) });
  }
}

/** Records a platform-level event (ingestion failures, provider errors, ...). */
export function systemEvent(
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical',
  source: string,
  message: string,
  meta?: unknown,
  orgId?: string,
): void {
  try {
    getDb()
      .insert(systemEvents)
      .values({
        id: newId('jev'),
        level,
        source,
        message,
        metaJson: meta === undefined ? null : JSON.stringify(meta),
        orgId: orgId ?? null,
        createdAt: Date.now(),
      })
      .run();
  } catch {
    /* never fatal */
  }
}
