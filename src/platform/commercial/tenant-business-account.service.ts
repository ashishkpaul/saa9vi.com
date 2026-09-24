import { Injectable } from "@nestjs/common";
import {
  AdministratorService,
  ForbiddenError,
  Logger,
  RequestContext,
} from "@vendure/core";

/**
 * PLATFORM-LEVEL TENANT BUSINESS-ACCOUNT AUTHORIZATION (plan §3.5, slice 8).
 *
 * The tenant-facing commercial read surface (`mySubscription`, `myLiveUsage`)
 * answers a question that Vendure's built-in permissions do NOT answer:
 *
 *   "Is the authenticated caller the *business account* that owns this tenant?"
 *
 * ── Why `Permission.Authenticated` alone is not sufficient ───────────────────
 * `Permission.Authenticated` means only "a user is logged in" — Vendure injects
 * it into every role it creates (`RoleService.create()` →
 * `unique([Permission.Authenticated, ...permissions])`), and
 * `TenantRegistrationService` additionally assigns the **Customer** role to
 * every tenant channel it provisions. A learner who logs in on
 * `academy.saa9vi.com` therefore satisfies `@Allow(Permission.Authenticated)`
 * on that channel. Gating commercial state on that permission would let any
 * enrolled learner read the academy's plan, billing period and exact live
 * usage. `Permission.Owner` does not help either: it is a *row*-level notion
 * whose check Vendure explicitly leaves to the resolver, and there is no
 * customer→tenant ownership row in this model.
 *
 * ── The definition this service implements ──────────────────────────────────
 * A tenant's **business account** is an Administrator whose role is assigned to
 * the tenant's channel. That is exactly the identity `TenantRegistrationService`
 * creates (`${code}-admin`, scoped to the one channel, INV-001) and returns to
 * the storefront as `administratorId`. Two properties follow, both deliberate:
 *
 *   - fail-closed for learners — a Customer is not an Administrator, so
 *     `findOneByUserId()` returns undefined and access is denied regardless of
 *     which roles that customer's user happens to carry;
 *   - platform staff retain access — the SuperAdmin role is assigned to every
 *     tenant channel at registration, so Portal staff can inspect a tenant's
 *     commercial state (which is what the Admin API already allows).
 *
 * `ctx.channelId` is the ONLY tenant input. There is deliberately no `channelId`
 * argument on the read surface: a caller can never name another tenant.
 *
 * Cross-plugin note: this lives in the platform commercial module (not in
 * SubscriptionPlugin) because "who owns this tenant" is a tenancy fact, not a
 * billing fact — the same reason `CommercialEntitlementService` is shared.
 */
@Injectable()
export class TenantBusinessAccountService {
  private static readonly loggerCtx = "TenantBusinessAccountService";

  constructor(private readonly administratorService: AdministratorService) {}

  /**
   * Whether the active caller is a business account of the ACTIVE channel.
   * Fails closed on: no active user, no resolved channel (an unknown or absent
   * channel token leaves `ctx.channelId` unset), a non-Administrator user, or
   * an Administrator whose roles are not assigned to this channel.
   */
  async isBusinessAccount(ctx: RequestContext): Promise<boolean> {
    if (!ctx.activeUserId || !ctx.channelId) {
      return false;
    }
    const administrator = await this.administratorService.findOneByUserId(
      ctx,
      ctx.activeUserId,
      ["user", "user.roles", "user.roles.channels"],
    );
    if (!administrator?.user) {
      // No Administrator row → a Customer session (learner), not a business
      // account. Deny: `Authenticated` is satisfied by learners by design.
      return false;
    }
    const roles = administrator.user.roles ?? [];
    return roles.some((role) =>
      (role.channels ?? []).some(
        (channel) => String(channel.id) === String(ctx.channelId),
      ),
    );
  }

  /**
   * Throws `ForbiddenError` unless the caller is a business account of the
   * active channel. The generic Vendure message is intentional: which of the
   * checks failed is not the caller's business.
   */
  async assertBusinessAccount(ctx: RequestContext): Promise<void> {
    if (!(await this.isBusinessAccount(ctx))) {
      Logger.debug(
        `Denied commercial read for user ${ctx.activeUserId ?? "anonymous"} on channel ${ctx.channelId ?? "none"}`,
        TenantBusinessAccountService.loggerCtx,
      );
      throw new ForbiddenError();
    }
  }
}
