import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus, Logger, RequestContext, TransactionalConnection } from "@vendure/core";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbPlatformCapacityPolicyService } from "../services/bbb-platform-capacity-policy.service";
import { BbbDailyAllowanceService } from "../services/bbb-daily-allowance.service";
import {
  SubscriptionPlanChangedEvent,
  SubscriptionRenewedEvent,
} from "../../subscription/events/subscription.events";

const loggerCtx = "BbbSubscriptionListener";

@Injectable()
export class BbbSubscriptionListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly capacityPolicyService: BbbPlatformCapacityPolicyService,
    private readonly dailyAllowanceService: BbbDailyAllowanceService,
  ) {}

  onModuleInit() {
    this.eventBus.ofType(SubscriptionRenewedEvent).subscribe(async (event) => {
      try {
        const org = await this.connection
          .getRepository(event.ctx, BbbOrganization)
          .findOne({ where: { channelId: event.channelId } });

        if (!org) {
          Logger.warn(
            `SubscriptionRenewedEvent: No BbbOrganization found for channelId ${event.channelId}`,
            loggerCtx,
          );
          return;
        }

        // NOTE: the plan-derived concurrency cache is deliberately NOT re-synced
        // here. A renewal re-asserts the SAME plan, so it cannot change a
        // plan-derived value; the triggers that can are organisation creation,
        // SubscriptionPlanChangedEvent below, and the startup reconciliation
        // pass (ADR-031 amendment, Decision 5).

        // BUG-032: Idempotency check for recurring grants
        const existingGrant = await this.connection
          .getRepository(event.ctx, BbbCapacityGrant)
          .findOne({
            where: {
              organization: { id: org.id },
              validFrom: event.billingPeriodStart,
              sourceType: "subscription",
            },
          });

        if (existingGrant) {
          Logger.warn(
            `SubscriptionRenewedEvent: Duplicate grant attempted for org=${org.slug} validFrom=${event.billingPeriodStart}. Skipping.`,
            loggerCtx,
          );
          return;
        }

        const grant = new BbbCapacityGrant({
          organization: org,
          grantedMinutes: event.grantedMinutes,
          consumedMinutes: 0,
          validFrom: event.billingPeriodStart,
          validUntil: event.billingPeriodEnd,
          exhausted: false,
          sourceType: "subscription",
          isUnbounded: false,
        });

        const saved = await this.connection
          .getRepository(event.ctx, BbbCapacityGrant)
          .save(grant);

        Logger.info(
          `Created recurring subscription capacity grant: org=${org.slug} grantId=${saved.id} minutes=${event.grantedMinutes}`,
          loggerCtx,
        );
      } catch (err: any) {
        Logger.error(
          `Failed to process SubscriptionRenewedEvent for channel ${event.channelId}: ${err.message}`,
          loggerCtx,
        );
      }
    });

    // ─── Plan identity established/changed → converge plan-derived capacity ───
    //
    // ADR-031 amendment (Decision 5). This trigger closes the registration gap:
    // the organisation is created by BbbTenantProvisioningListener under
    // TenantRegisteredEvent, and this plugin is registered before the
    // subscription plugin, so at that moment the free plan's subscription row
    // usually does not exist yet and the plan-matched tier cannot resolve.
    // Consuming the subscription side's announcement afterwards makes the
    // outcome independent of subscriber order, instead of depending on a
    // registration ordering that is not guaranteed.
    //
    // No dedup/version bookkeeping: the work is an idempotent re-derivation, so
    // duplicate or late events are harmless, and a missed one is healed by the
    // startup reconciliation pass.
    this.eventBus.ofType(SubscriptionPlanChangedEvent).subscribe(async (event) => {
      try {
        const org = await this.connection
          .getRepository(event.ctx, BbbOrganization)
          .findOne({ where: { channelId: event.channelId } });

        if (!org) {
          // Expected in the window where a subscription exists but the
          // organisation was never provisioned — a real provisioning gap, so
          // surface it rather than fail silently.
          Logger.warn(
            `SubscriptionPlanChangedEvent (${event.cause}, plan ${event.planId}): ` +
              `no BbbOrganization found for channelId ${event.channelId}; ` +
              `plan-derived capacity not applied`,
            loggerCtx,
          );
          return;
        }

        await this.convergeConcurrentMeetingLimit(event.ctx, org, event.cause);

        // ─── Slice 6: daily allowance for a provider-free plan ───────────────
        //
        // Second trigger for the SAME writer. `BbbDailyAllowanceService` owns
        // the daily grant; this consumer only asks it to materialise today's
        // grant the moment the plan identity is committed, so a tenant's very
        // first meeting does not depend on waiting for the hourly sweep.
        //
        // Fail-soft and separate from the convergence above: a free-plan
        // registration must not fail because a grant could not be written, and
        // a capacity fault must not mask an allowance fault. The scheduled sweep
        // is the healing path for both, exactly as ADR-031 Decision 5 prescribes
        // for plan-derived capacity.
        try {
          await this.dailyAllowanceService.ensureDailyGrantForChannel(
            event.channelId,
            `plan-changed:${event.cause}`,
          );
        } catch (err: any) {
          Logger.error(
            `Daily allowance ensure failed for channel ${event.channelId} ` +
              `(cause ${event.cause}, plan ${event.planId}): ${err?.message ?? err}. ` +
              `The scheduled daily-allowance sweep will retry.`,
            loggerCtx,
          );
        }
      } catch (err: any) {
        Logger.error(
          `Failed to process SubscriptionPlanChangedEvent for channel ${event.channelId} ` +
            `(cause ${event.cause}, plan ${event.planId}): ${err.message}`,
          loggerCtx,
        );
      }
    });
  }

  /**
   * Re-derive `org.concurrentMeetingLimit` from the effective capacity policy
   * and write it through when it differs.
   *
   * The guard that keeps Admin-set paid-tier values safe lives inside
   * `BbbPlatformCapacityPolicyService.syncConcurrentMeetingLimit()`
   * (`isPlanDerived`), NOT here — so this stays a plain "converge to the current
   * policy" step that every trigger can call without repeating policy-source
   * logic, and a trigger cannot accidentally widen the rule.
   *
   * Shared with the startup reconciliation pass so the two paths cannot drift.
   * Idempotent: a no-op when the cached value already matches the policy.
   */
  async convergeConcurrentMeetingLimit(
    ctx: RequestContext,
    org: BbbOrganization,
    trigger: string,
  ): Promise<void> {
    const policy = await this.capacityPolicyService.getEffectivePolicy(
      ctx,
      org.channelId,
    );
    const changed = await this.capacityPolicyService.syncConcurrentMeetingLimit(
      ctx,
      org,
      policy,
    );
    if (changed) {
      Logger.info(
        `Plan-derived capacity converged for org=${org.slug} ` +
          `(concurrentMeetingLimit=${org.concurrentMeetingLimit}, trigger=${trigger})`,
        loggerCtx,
      );
    }
  }
}
