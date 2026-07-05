import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { RequestContextService, EventBus } from "@vendure/core";
import { Connection } from "typeorm";
import { CapacityIntelligenceService } from "../services/capacity-intelligence.service";
import { BbbCapacityAlertLog } from "../entities/bbb-capacity-alert-log.entity";
import { CapacityAlertEvent } from "../events/bbb-events";

const loggerCtx = "BbbCapacityAlertTask";

/**
 * Scheduled job that runs every 15 minutes to:
 * 1. Build capacity dashboard
 * 2. Append an audit log entry (always)
 * 3. Publish CapacityAlertEvent if urgency is 'soon' or 'immediate'
 *
 * See ADR v1.7 §6A CI-005.
 */
export const bbbCapacityAlertTask = new ScheduledTask({
  id: "bbb-capacity-alert",
  description:
    "Analyze capacity forecast and alert operators when load is approaching saturation",
  schedule: (cron) => cron.every(15).minutes(),
  async execute({ injector }) {
    const capacityIntelligenceService = injector.get(CapacityIntelligenceService);
    const ctxService = injector.get(RequestContextService);
    const eventBus = injector.get(EventBus);

    const ctx = await ctxService.create({ apiType: "admin" });

    try {
      const dashboard = await capacityIntelligenceService.buildDashboard(ctx);
      const { recommendation } = dashboard;

      // Always append an audit log row (INV-002 extended)
      const alertLog = new BbbCapacityAlertLog({
        checkedAt: new Date(),
        urgency: recommendation.urgency,
        serversNeeded: recommendation.serversNeeded,
        peakForecastPercent: recommendation.peakForecastPercent,
        peakForecastAt: recommendation.peakForecastAt,
        reasoning: recommendation.reasoning,
      });

      const connection = injector.get(Connection);
      await connection.getRepository(BbbCapacityAlertLog).save(alertLog);

      // Publish event for urgency levels that require operator attention
      if (recommendation.urgency === "soon" || recommendation.urgency === "immediate") {
        const alertEvent = new CapacityAlertEvent(
          recommendation.urgency,
          recommendation.reasoning,
          recommendation.peakForecastAt,
          recommendation.serversNeeded
        );

        eventBus.publish(alertEvent);

        Logger.warn(
          `Capacity alert [${recommendation.urgency}]: ${recommendation.reasoning}`,
          loggerCtx
        );
      }

      return {
        checked: true,
        urgency: recommendation.urgency,
        serversNeeded: recommendation.serversNeeded,
      };
    } catch (error: any) {
      Logger.error(`Capacity alert job failed: ${error.message}`, loggerCtx, error.stack);
      throw error;
    }
  },
});