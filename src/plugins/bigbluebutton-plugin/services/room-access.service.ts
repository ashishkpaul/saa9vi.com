import { Injectable, Inject } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";

import { BbbMemberService } from "./bbb-member.service";
import { BbbMembershipService } from "./bbb-membership.service";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbEntitlement, isEntitlementRowLive } from "../entities/bbb-entitlement.entity";
import { deriveRoomAccess, RoomAccessDecision } from "./room-access.policy";
import { LEARNER_ADMISSION_PORT, LearnerAdmissionStatus } from "../../../platform/learner-admission.port";

/**
 * INV-027 (BUG-045) — the ONE place room access is evaluated.
 *
 * `bbbRoomStatus` (preview) and `BbbMeetingService.joinRoom` (action) both
 * delegate here, so the two surfaces cannot drift apart again: the same four
 * sources, the same window semantics (`room-access.policy.ts`), the same
 * decision. `joinRoom` calls this BEFORE `requestProvisioning`.
 *
 * Notes:
 * - The four row fetches run in parallel; the policy is pure and runs after.
 * - The entitlement lookup is intentionally NOT filtered by `ctx.channelId`
 *   (unlike `BbbEntitlementService.hasAccess`): the room identity already pins
 *   the tenant (room → organization → channel is enforced by
 *   `BbbChannelAccessService.assertRoomAccess` when the room is fetched), and
 *   filtering by channelId here would reintroduce a preview-vs-join divergence
 *   for entitlement rows with a null channelId.
 * - BB2: learner suspension is enforced here for learner-facing access
 *   sources (entitlement, enrollment, session entitlement). Staff sources
 *   (membership, legacyMember) are NOT blocked — a suspended learner who is
 *   also staff still gets in through their staff membership.
 */
@Injectable()
export class BbbRoomAccessService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly membershipService: BbbMembershipService,
    private readonly memberService: BbbMemberService,
    @Inject(LEARNER_ADMISSION_PORT)
    private readonly admissionPort: {
      getStatus(
        ctx: RequestContext,
        customerId: ID,
        channelId: string,
      ): Promise<LearnerAdmissionStatus | null>;
    },
  ) {}

  /**
   * BB2: a learner whose TenantLearnerMembership is not ACTIVE is blocked
   * from joining rooms through learner-facing access sources (entitlement,
   * enrollment, session entitlement).
   *
   * Only explicit ACTIVE status passes. SUSPENDED, REVOKED, LEFT and PENDING
   * all block, because a PENDING learner (admitted or readmitted but not yet
   * activated) has not been approved for academy access. No membership row
   * (null) does NOT block, so purchase flows and trial attendees are not
   * broken.
   */
  async isLearnerBlocked(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<boolean> {
    const status = await this.admissionPort.getStatus(
      ctx,
      customerId,
      String(ctx.channelId),
    );
    return status !== null && status !== "ACTIVE";
  }

  async evaluate(
    ctx: RequestContext,
    customerId: ID,
    organizationId: ID,
    roomId: ID,
  ): Promise<RoomAccessDecision> {
    const [membership, legacyMember, entitlementRows, enrollment] =
      await Promise.all([
        this.membershipService.findActiveMembership(
          ctx,
          customerId,
          organizationId,
        ),
        this.memberService.findActiveMembership(
          ctx,
          customerId,
          organizationId,
        ),
        // W5 follow-up 2/5: the natural key can hold MULTIPLE entitlement rows
        // (history), so a findOne picks an arbitrary row and the decision
        // becomes order-dependent. Fetch ALL rows for the key and pass a
        // started-and-unexpired one when any exists (ANY-live); otherwise pass
        // the first stale row so the pure policy still derives a denial.
        this.connection
          .getRepository(ctx, BbbEntitlement)
          .find({
            where: {
              customerId: String(customerId),
              type: "bbb_room",
              resourceId: String(roomId),
            },
          }),
        this.connection
          .getRepository(ctx, BbbEnrollment)
          .findOne({
            where: {
              roomId: String(roomId),
              customerId: String(customerId),
              active: true,
            },
          }),
      ]);
    const now = new Date();
    const entitlement =
      entitlementRows.find((r) => isEntitlementRowLive(r, now)) ??
      entitlementRows[0] ??
      null;

    const decision = deriveRoomAccess(
      { membership, legacyMember, entitlement, enrollment },
      now,
    );

    // BB2: learner-facing access sources are blocked for suspended learners.
    // Staff sources (membership, legacyMember) are not blocked.
    if (
      decision.allowed &&
      decision.source !== "membership" &&
      decision.source !== "legacy_member" &&
      (await this.isLearnerBlocked(ctx, customerId))
    ) {
      return { allowed: false, isModerator: false, source: null };
    }

    return decision;
  }
}