import { Injectable, Logger } from "@nestjs/common";
import { RequestContext, TransactionalConnection } from "@vendure/core";
import { PaymentEventLog } from "../entity/payment-event-log.entity";

export interface ObservabilitySpan {
  end(error?: Error): void;
}

@Injectable()
export class PaymentObservabilityService {
  private readonly logger = new Logger(PaymentObservabilityService.name);

  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * Check and record an idempotency key to prevent duplicate processing.
   * Used by any financial plugin — pass domain as a namespacing prefix.
   *
   * Key format convention: '{domain}:{event_type}:{resource_id}'
   * Examples:
   *   'juspay:ORDER_SUCCEEDED:ORD-123'
   *   'cashback:earn:order-456'
   *   'ledger:CREDIT:order-789-line-1'
   *
   * Returns true if this is the first time the key is seen (proceed).
   * Returns false if already processed (skip — idempotent).
   */
  async checkAndRecord(
    ctx: RequestContext,
    eventKey: string,
    domain: string,
    payloadSnapshot?: string,
  ): Promise<boolean> {
    const repo = this.connection.getRepository(ctx, PaymentEventLog);

    const existing = await repo.findOne({ where: { eventKey } });
    if (existing) {
      this.logger.debug(`Duplicate skipped [${domain}]: ${eventKey}`);
      return false;
    }

    try {
      await repo.save({
        eventKey,
        gateway: domain,
        payloadSnapshot: payloadSnapshot ?? null,
      });
      return true;
    } catch (error: any) {
      const msg = error.message || error.toString();
      const isDuplicate =
        error.code === "23505" ||
        error.code === "ER_DUP_ENTRY" ||
        error.code === "SQLITE_CONSTRAINT" ||
        msg.includes("UNIQUE constraint failed");

      if (isDuplicate) {
        this.logger.debug(
          `Concurrent duplicate blocked [${domain}]: ${eventKey}`,
        );
        return false;
      }
      throw error;
    }
  }

  /**
   * Start an observability span.
   *
   * Returns an object with end(err?: Error): void
   * No-op implementation that logs verbose start/end with elapsed ms.
   * JSDoc: "Replace with real OpenTelemetry span in production."
   *
   * IMPORTANT — spans must be async-safe:
   * All callers MUST use try/finally:
   *   const span = startSpan(...)
   *   try { ... } finally { span.end(err) }
   * Document this requirement in JSDoc.
   */
  startSpan(name: string, attrs?: Record<string, string>): ObservabilitySpan {
    const startTime = Date.now();
    this.logger.verbose(
      `Span started: ${name} ${attrs ? JSON.stringify(attrs) : ""}`,
    );

    return {
      end: (error?: Error) => {
        const duration = Date.now() - startTime;
        const status = error ? "ERROR" : "OK";
        this.logger.verbose(`Span ended: ${name} [${status}] ${duration}ms`);
      },
    };
  }
}
