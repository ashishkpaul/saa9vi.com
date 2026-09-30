import { Injectable } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";

import { BbbMemberService } from "./bbb-member.service";
import { BbbMembershipService } from "./bbb-membership.service";
import { BbbEnrollment } from "../entities/bbb-enrollment.entity";
import { BbbEntitlement } from "../entities/bbb-entitlement.entity";
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
    const [membership, legacyMember, entitlement, enrollment] =
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
        this.connection
          .getRepository(ctx, BbbEntitlement)
          .findOne({
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

    return deriveRoomAccess(
      { membership, legacyMember, entitlement, enrollment },
      new Date(),
    );
  }
}