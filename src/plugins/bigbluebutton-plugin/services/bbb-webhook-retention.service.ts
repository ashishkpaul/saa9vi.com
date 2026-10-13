import { Injectable, Logger } from "@nestjs/common";
import { TransactionalConnection } from "@vendure/core";
import { LessThan } from "typeorm";
import { BbbWebhookEvent } from "../entities/bbb-webhook-event.entity";

const loggerCtx = "BbbWebhookRetentionService";

/**
 * Prunes processed BBB webhook events past their retention window.
 *
 * Retention policy (90 days):
 *   PROCESSED    — terminal success, safe to prune
 *   PARSE_FAILED — terminal, raw body kept for 90 days for audit
 *   PENDING      — never pruned (still needs processing)
 *   FAILED       — never pruned (needs manual review / replay)
 */
@Injectable()
export class BbbWebhookRetentionService {
  constructor(private readonly connection: TransactionalConnection) {}

  async pruneEvents(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const repo = this.connection.rawConnection.getRepository(BbbWebhookEvent);

    const r1 = await repo.delete({
      status: "PROCESSED" as any,
      receivedAt: LessThan(cutoff),
    });
    const r2 = await repo.delete({
      status: "PARSE_FAILED" as any,
      receivedAt: LessThan(cutoff),
    });
    const total = (r1.affected ?? 0) + (r2.affected ?? 0);
    if (total > 0) {
      Logger.log(
        `Pruned ${total} webhook event(s) older than ${cutoff.toISOString()} ` +
          `(processed=${r1.affected ?? 0} parse_failed=${r2.affected ?? 0})`,
        loggerCtx,
      );
    }
    return total;
  }
}
