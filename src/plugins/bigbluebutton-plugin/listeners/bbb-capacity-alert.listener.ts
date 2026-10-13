import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus, Logger } from "@vendure/core";
import { CapacityAlertEvent } from "../events/bbb-events";
import { BbbOpsAlertService } from "../services/bbb-ops-alert.service";

const loggerCtx = "BbbCapacityAlertListener";

/**
 * Delivers `CapacityAlertEvent` to the operator channel (production-readiness
 * review, critical item 6).
 *
 * The 15-minute `bbbCapacityAlertTask` has always appended a
 * `BbbCapacityAlertLog` row and published this event — but nothing consumed
 * the event, so an "immediate: >90% projected load, N servers needed" alert
 * lived only in a Postgres table nobody reads during an incident. This
 * listener closes that gap: `urgency: 'immediate'` always notifies (log +
 * `OPS_ALERT_WEBHOOK_URL`), `urgency: 'soon'` is log-only to keep the pager
 * quiet until the threshold that matters.
 *
 * Registered in `bigbluebutton.plugin.ts` providers. Non-blocking by
 * construction: `BbbOpsAlertService.notify` never throws, and the EventBus
 * subscription handler wraps in a catch (INV-012 — capacity stays advisory).
 */
@Injectable()
export class BbbCapacityAlertListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly opsAlert: BbbOpsAlertService,
  ) {}

  onModuleInit(): void {
    this.eventBus.ofType(CapacityAlertEvent).subscribe((event) => {
      try {
        this.handle(event);
      } catch (err) {
        // Alerting must never break the capacity task that published the event.
        Logger.error(
          `Capacity alert delivery failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          loggerCtx,
        );
      }
    });
  }

  private handle(event: CapacityAlertEvent): void {
    const summary =
      `Capacity ${event.urgency}: ${event.message} ` +
      `(servers needed: ${event.serversNeeded}, peak forecast at: ${event.peakForecastAt.toISOString()})`;

    if (event.urgency === "immediate") {
      this.opsAlert.notify(
        "capacity-immediate",
        "pool", // one pool-level alert per hour, not per 15-min tick
        summary,
        {
          urgency: event.urgency,
          serversNeeded: event.serversNeeded,
          peakForecastAt: event.peakForecastAt.toISOString(),
          message: event.message,
        },
      );
      return;
    }

    // 'soon' — visible in logs, no webhook/pager.
    Logger.warn(summary, loggerCtx);
  }
}