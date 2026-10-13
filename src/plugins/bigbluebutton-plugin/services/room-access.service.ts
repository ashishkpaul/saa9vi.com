import { Injectable } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";

import { BbbMemberService } from "./bbb-member.service";
import { BbbMembershipService } from "./bbb-membership.service";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import {
  BbbEntitlement,
  isEntitlementRowLive,
} from "../entities/bbb-entitlement.entity";
import {
  deriveRoomAccess,
  RoomAccessDecision,
} from "./room-access.policy";

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
 */
@Injectable()
export class BbbRoomAccessService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly membershipService: BbbMembershipService,
    private readonly memberService: BbbMemberService,
  ) {}

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

    return deriveRoomAccess(
      { membership, legacyMember, entitlement, enrollment },
      now,
    );
  }
}