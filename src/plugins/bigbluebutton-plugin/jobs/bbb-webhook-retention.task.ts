import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbWebhookRetentionService } from "../services/bbb-webhook-retention.service";

const loggerCtx = "BbbWebhookRetentionTask";

/**
 * Daily pruning of processed BBB webhook events (item 11).
 *
 * Retention: 90 days for PROCESSED and PARSE_FAILED rows.
 * PENDING and FAILED rows are never auto-deleted — they need manual action.
 * Schedule: daily at 03:00 (metering prune runs at 03:30, spread I/O).
 */
export const bbbWebhookRetentionTask = new ScheduledTask({
  id: "bbb-webhook-retention",
  description: "Prune processed BBB webhook events older than 90 days",
  schedule: (cron) => cron.every(1).days(3, 0),
  async execute({ injector }) {
    const retentionService = injector.get(BbbWebhookRetentionService);
    try {
      const pruned = await retentionService.pruneEvents();
      return { pruned };
    } catch (err) {
      Logger.error(
        `BBB webhook retention prune failed: ${(err as Error).message}`,
        loggerCtx,
        (err as Error).stack,
      );
      return { pruned: 0 };
    }
  },
});
