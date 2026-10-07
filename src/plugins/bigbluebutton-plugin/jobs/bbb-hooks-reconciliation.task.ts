import { ScheduledTask } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { BbbHooksService } from "../services/bbb-hooks.service";

const loggerCtx = "BbbHooksReconciliationTask";

/**
 * W4 — Periodic webhook hook reconciliation.
 *
 * Every 5–10 minutes, calls `BbbHooksService.ensureAllWebhooks()` for all
 * enabled, healthy BBB servers:
 *   - Lists current hooks via hooks/list
 *   - Creates a missing hook via hooks/create
 *   - Detects stale hooks (e.g. after a publicBaseUrl change) and destroys +
 *     recreates them via hooks/destroy + hooks/create
 *
 * This is idempotent: running it when the hook is already correct is a no-op
 * (one `hooks/list` call, nothing created or destroyed).
 *
 * Failed servers are logged and the task continues with the remaining servers
 * (Promise.allSettled inside ensureAllWebhooks).
 */
export const bbbHooksReconciliationTask = new ScheduledTask({
  id: "bbb-hooks-reconciliation",
  description:
    "W4: Ensure BBB webhook hooks are registered and not stale on all enabled servers",
  schedule: (cron) => cron.every(5).minutes(),
  async execute({ injector }) {
    const hooksService = injector.get(BbbHooksService);
    try {
      await hooksService.ensureAllWebhooks();
      return { ok: true };
    } catch (err) {
      Logger.error(
        `BBB hooks reconciliation failed: ${(err as Error).message}`,
        loggerCtx,
        (err as Error).stack,
      );
      return { ok: false };
    }
  },
});
