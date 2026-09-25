import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbPlatformCapacityPolicyService } from "../services/bbb-platform-capacity-policy.service";

const loggerCtx = "BbbPlanCapacityReconciliation";

/**
 * Startup reconciliation for plan-derived tenant capacity (ADR-031's
 * 2026-09-25 amendment, Decision 5 — the third and final convergence trigger).
 *
 * `BbbOrganization.concurrentMeetingLimit` is a denormalized cache of
 * `BbbPlatformCapacityPolicy.maxConcurrentMeetings`. The other two triggers are
 * event-driven and therefore *lossy by nature*: a crash between the subscription
 * commit and the consumer running, a listener exception, a policy row edited
 * while the org already existed, or a tenant that predates this feature all
 * leave the cache stale. This pass makes correctness a property of the system
 * rather than of event delivery — every start re-derives every organisation
 * from the same `isPlanDerived`-guarded code path the listeners use.
 *
 * Deliberately NOT a fan-out on policy writes: a Portal Admin editing a plan's
 * ceiling converges here at the next start (and immediately for tenants created
 * or moved afterwards). Hot-reloading that fan-out was ruled out of scope
 * because it turns one policy write into an unbounded per-request loop over
 * every tenant.
 *
 * Idempotent and safe to run repeatedly: organisations already matching the
 * policy are read but not written. Bounded by a cheap early exit, so an
 * installation that has not adopted capacity policies pays one COUNT query.
 */
@Injectable()
export class BbbPlanCapacityReconciliationBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly capacityPolicyService: BbbPlatformCapacityPolicyService,
    private readonly requestContextService: RequestContextService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reconcileAllOrganizations();
    } catch (err: unknown) {
      // Never let a cache-repair pass block the server from starting: a failure
      // here degrades to "the cache is stale until the next successful start or
      // the next subscription event", which is exactly the state we were in
      // before this class existed.
      Logger.error(
        `Plan-derived capacity reconciliation failed: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Organization concurrentMeetingLimit values may be stale until the next ` +
          `successful start or subscription change.`,
        loggerCtx,
      );
    }
  }

  /**
   * Re-derive `concurrentMeetingLimit` for every organisation.
   *
   * @returns the number of organisations whose cached value was corrected.
   */
  async reconcileAllOrganizations(): Promise<number> {
    const startedAt = Date.now();
    const ctx = await this.requestContextService.create({ apiType: "admin" });

    // Early exit: while no policy row exists at all, capacity policy is not
    // adopted and every organisation legitimately holds its form/Admin value
    // (INV-015's opt-in adoption). Re-deriving would resolve to the Tier 4
    // fallback, which `isPlanDerived()` rejects anyway — so skip the scan.
    if (!(await this.capacityPolicyService.hasAnyPolicy(ctx))) {
      Logger.debug(
        `No capacity policy rows exist; plan-derived capacity is not adopted — skipping reconciliation`,
        loggerCtx,
      );
      return 0;
    }

    // Read through the RAW connection, deliberately not through `ctx`.
    // Vendure's `getRepository(ctx, …)` returns a plain repository unless an
    // `entityAccessControlStrategy` is configured, so a ctx-scoped read would
    // ALSO work today — but it would silently become "only the default
    // channel's organisations" the moment such a strategy is introduced, and
    // BbbOrganization is ChannelAware. A raw read is immune to that, which
    // matters because a partial scan would look like success.
    //
    // (This project configures no entityAccessControlStrategy. If one is ever
    // added, revisit the per-org saves below, which do go through `ctx`.)
    const orgs = await this.connection.rawConnection
      .getRepository(BbbOrganization)
      .find();

    if (orgs.length === 0) {
      Logger.debug(`No organizations to reconcile`, loggerCtx);
      return 0;
    }

    let corrected = 0;
    let skippedNoChannel = 0;
    for (const org of orgs) {
      if (!org.channelId) {
        // Invariant violation (INV-001: every org is channel-owned). Counted
        // rather than thrown so one bad row cannot abort the whole pass.
        skippedNoChannel++;
        continue;
      }
      try {
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
          corrected++;
          Logger.info(
            `Reconciled org=${org.slug} concurrentMeetingLimit=${org.concurrentMeetingLimit} ` +
              `(policy source: ${policy.source})`,
            loggerCtx,
          );
        }
      } catch (err: unknown) {
        Logger.error(
          `Reconciliation failed for org=${org.slug} (channel ${org.channelId}): ` +
            `${err instanceof Error ? err.message : String(err)}`,
          loggerCtx,
        );
      }
    }

    Logger.info(
      `Plan-derived capacity reconciliation complete: scanned=${orgs.length} ` +
        `corrected=${corrected} unmatched=${orgs.length - corrected}` +
        (skippedNoChannel > 0 ? ` skippedNoChannel=${skippedNoChannel}` : ``) +
        ` in ${Date.now() - startedAt}ms`,
      loggerCtx,
    );
    return corrected;
  }
}
