import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';

const loggerCtx = 'PaymentOpsAlertService';
const DEDUPE_TTL_MS = 60 * 60 * 1000; // 1 hour per (kind, key)

/**
 * Commit 2 — payment ops-alert channel.
 *
 * Deliberately separate from BbbOpsAlertService (different lifecycle, ADR-038
 * boundary): a captured payment landing on a non-ArrangingPayment order is a
 * money-path anomaly an operator must see, not a silent 'ignored'.
 *
 * Same delivery contract: fire-and-forget POST to OPS_ALERT_WEBHOOK_URL,
 * always Logger.warn first, failures never thrown.
 */
@Injectable()
export class PaymentOpsAlertService {
  private readonly lastSentAt = new Map<string, number>();

  notify(kind: string, dedupeKey: string, summary: string, payload: Record<string, unknown> = {}): void {
    const dedupe = `${kind}:${dedupeKey}`;
    const now = Date.now();
    const last = this.lastSentAt.get(dedupe);
    if (last !== undefined && now - last < DEDUPE_TTL_MS) return;
    this.lastSentAt.set(dedupe, now);
    if (this.lastSentAt.size > 1000) {
      for (const [key, at] of this.lastSentAt) {
        if (now - at >= DEDUPE_TTL_MS) this.lastSentAt.delete(key);
      }
    }

    Logger.warn(`PAYMENT-OPS-ALERT [${kind}] ${summary}`, loggerCtx);

    const url = process.env.OPS_ALERT_WEBHOOK_URL;
    if (!url) return;

    const body = JSON.stringify({ kind, summary, payload, at: new Date().toISOString() });
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    }).then(
      (res) => {
        if (!res.ok) Logger.warn(`Payment ops alert webhook answered ${res.status}: ${summary}`, loggerCtx);
      },
      (err: unknown) => {
        Logger.warn(
          `Payment ops alert webhook failed (log channel still received it): ${err instanceof Error ? err.message : String(err)}`,
          loggerCtx,
        );
      },
    );
  }
}
