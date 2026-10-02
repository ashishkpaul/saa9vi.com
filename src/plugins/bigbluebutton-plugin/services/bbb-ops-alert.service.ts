/**
 * Operator alert channel (production-readiness review, critical item 6 +
 * ADR-047 decision 12).
 *
 * Two signals route through here:
 *   1. `CapacityAlertEvent` with `urgency: 'immediate'` (from the 15-min
 *      capacity task) — projected load > 90%, N servers needed;
 *   2. the metered spend limit approaching 90% of `monthlySpendLimitPaise`.
 *
 * Before this existed both signals were written to Postgres and *nothing
 * else* — nobody reads a table during an incident. Delivery is a fire-and-
 * forget JSON POST to `OPS_ALERT_WEBHOOK_URL` (Slack/Discord/PagerDuty
 * incoming webhook — the lowest-common-denominator channel that needs no
 * SMTP transport), ALWAYS accompanied by a `Logger.warn` so a missing/failed
 * webhook degrades to log-based alerting rather than silence.
 *
 * De-duplicated per `(kind, dedupeKey)` for one hour: the spend check runs on
 * every start-room click and the worker re-check, so without this the webhook
 * would fire per click. Failures are logged and never thrown — alerting must
 * not break provisioning (INV-012: capacity is advisory).
 */
import { Injectable } from "@nestjs/common";
import { Logger } from "@vendure/core";

const loggerCtx = "BbbOpsAlertService";
const DEDUPE_TTL_MS = 60 * 60 * 1000; // 1 hour per (kind, key)

@Injectable()
export class BbbOpsAlertService {
  private readonly lastSentAt = new Map<string, number>();

  /**
   * Emit an operator alert. Synchronous fire-and-forget: the webhook POST is
   * detached (never awaited) so callers on the provisioning path are not
   * slowed or failed by an alerting outage.
   */
  notify(
    kind: string,
    dedupeKey: string,
    summary: string,
    payload: Record<string, unknown> = {},
  ): void {
    const dedupe = `${kind}:${dedupeKey}`;
    const now = Date.now();
    const last = this.lastSentAt.get(dedupe);
    if (last !== undefined && now - last < DEDUPE_TTL_MS) return;
    this.lastSentAt.set(dedupe, now);
    // Opportunistic pruning so the map cannot grow unbounded across tenants.
    if (this.lastSentAt.size > 1000) {
      for (const [key, at] of this.lastSentAt) {
        if (now - at >= DEDUPE_TTL_MS) this.lastSentAt.delete(key);
      }
    }

    // Always visible in logs first — the baseline channel.
    Logger.warn(`OPS-ALERT [${kind}] ${summary}`, loggerCtx);

    const url = process.env.OPS_ALERT_WEBHOOK_URL;
    if (!url) return; // log-only mode is a valid, documented deployment

    const body = JSON.stringify({ kind, summary, payload, at: new Date().toISOString() });
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5000),
    }).then(
      (res) => {
        if (!res.ok) {
          Logger.warn(`Ops alert webhook answered ${res.status}: ${summary}`, loggerCtx);
        }
      },
      (err: unknown) => {
        Logger.warn(
          `Ops alert webhook failed (log channel still received it): ${
            err instanceof Error ? err.message : String(err)
          }`,
          loggerCtx,
        );
      },
    );
  }
}