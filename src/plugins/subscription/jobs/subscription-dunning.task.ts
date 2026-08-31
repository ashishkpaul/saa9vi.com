import { ScheduledTask, TransactionalConnection } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { SubscriptionRenewalQueueService } from "../services/subscription-renewal-queue.service";

const loggerCtx = "SubscriptionDunningTask";

/**
 * Dunning job — recovers past_due subscriptions per RFC-001 §4.2.
 *
 * Discovery: finds subscriptions in "past_due" status whose last dunning
 * attempt is older than the retry interval. For each:
 *   - increments dunningRetryCount
 *   - re-enqueues a renewal attempt via SubscriptionRenewalQueueService
 *   - after max retries, cancels the subscription
 *
 * Retry schedule (configurable via env):
 *   DUNNING_RETRY_INTERVAL_DAYS (default 3) — days between retry attempts
 *   DUNNING_MAX_RETRIES (default 4) — attempts before auto-cancellation
 *
 * Runs hourly. The renewal worker handles the actual charge; this job
 * only decides WHEN to retry and WHEN to give up.
 */
export const subscriptionDunningTask = new ScheduledTask({
    id: "subscription-dunning",
    description: "Dunning retry schedule for past_due subscriptions",
    schedule: (cron) => cron.every(1).hours(),
    async execute({ injector }) {
        const connection = injector.get(TransactionalConnection);
        const renewalQueue = injector.get(SubscriptionRenewalQueueService);

        const retryIntervalDays = Number(process.env.DUNNING_RETRY_INTERVAL_DAYS ?? 3);
        const maxRetries = Number(process.env.DUNNING_MAX_RETRIES ?? 4);
        const now = new Date();
        const retryThreshold = new Date(now.getTime() - retryIntervalDays * 86400000);

        const rawRepo = connection.rawConnection.getRepository("organization_subscription");

        // Find past_due subscriptions due for a retry
        const dueForRetry = await rawRepo
            .createQueryBuilder("sub")
            .where("sub.status = :status", { status: "past_due" })
            .andWhere(
                "(sub.dunningRetryCount IS NULL OR sub.dunningRetryCount < :maxRetries)",
                { maxRetries },
            )
            .andWhere(
                "(sub.lastDunningAttemptAt IS NULL OR sub.lastDunningAttemptAt <= :threshold)",
                { threshold: retryThreshold },
            )
            .getMany();

        let retried = 0;
        let cancelled = 0;

        for (const sub of dueForRetry) {
            const retryCount = (sub as any).dunningRetryCount ?? 0;

            if (retryCount + 1 >= maxRetries) {
                // Max retries exceeded — cancel the subscription
                await rawRepo.update(
                    { id: (sub as any).id },
                    { status: "cancelled", cancelledAt: now },
                );
                Logger.log(
                    `Subscription ${(sub as any).id} (channel ${(sub as any).channelId}) cancelled after ${retryCount} dunning retries`,
                    loggerCtx,
                );
                cancelled++;
            } else {
                // Re-enqueue for another renewal attempt
                await rawRepo.update(
                    { id: (sub as any).id },
                    {
                        dunningRetryCount: retryCount + 1,
                        lastDunningAttemptAt: now,
                    },
                );
                await renewalQueue.addRenewalJob((sub as any).id);
                Logger.log(
                    `Subscription ${(sub as any).id} (channel ${(sub as any).channelId}) dunning retry #${retryCount + 1} enqueued`,
                    loggerCtx,
                );
                retried++;
            }
        }

        if (retried > 0 || cancelled > 0) {
            Logger.log(
                `Dunning scan finished: retried=${retried} cancelled=${cancelled}`,
                loggerCtx,
            );
        }

        return { retried, cancelled };
    },
});
