import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index } from "typeorm";

export type EntitlementType = "bbb_session" | "bbb_room";
export type EntitlementSource = "purchase" | "trial" | "trial_conversion" | "admin" | "import";

/**
 * Grant of access to a specific resource.
 *
 * This is the ADR-targeted access primitive. It replaces the role of
 * BbbEnrollment for session-scoped access and will eventually subsume
 * room-scoped access as well.
 *
 * Current scope (Phase 1.5):
 * - "bbb_session": access to a specific BbbScheduledSession
 * - "bbb_room": (future) room access, currently still handled by BbbEnrollment
 *
 * Key design decision: Entitlement is *not* ChannelAware. It carries
 * a scalar channelId for channel isolation without the complexity of
 * Vendure's Channel junction table.
 *
 * Liveness (W5 follow-up 2/5 — duplicate rows): the natural key (channel,
 * customer, type, resource) can carry MULTIPLE rows — the resolver create was
 * non-idempotent before the re-grant fix, so history holds duplicates.
 * One-row-per-key assumptions (findOne-then-decide) are order-dependent and
 * wrong. Every reader/writer uses the helpers below:
 *   unexpired = validUntil null or > now      (an active grant, started or
 *               not — governs grant-return and revoke scope)
 *   live      = started (validFrom null or <= now) AND unexpired
 *               (governs ACCESS: hasAccess = ANY live row)
 *   revoke    = deactivate every UNEXPIRED row for the key in one operation
 *               (a future-dated row must not resurrect access after revoke)
 *   grant     = advisory-lock txn → return an unexpired row else insert a NEW
 *               row; revoked rows are kept as history, never reactivated.
 */
export interface EntitlementLike {
  validFrom?: Date | null;
  validUntil?: Date | null;
}

/** An active grant: not expired. Future-dated rows still count (scheduled). */
export function isEntitlementRowUnexpired(
  row: EntitlementLike,
  now: Date = new Date(),
): boolean {
  return row.validUntil == null || row.validUntil > now;
}

/** Access-live: started AND unexpired. */
export function isEntitlementRowLive(
  row: EntitlementLike,
  now: Date = new Date(),
): boolean {
  if (row.validFrom != null && row.validFrom > now) return false;
  return isEntitlementRowUnexpired(row, now);
}

/** ANY-live over the rows sharing one natural key. */
export function anyEntitlementRowLive(
  rows: EntitlementLike[],
  now: Date = new Date(),
): boolean {
  return rows.some((r) => isEntitlementRowLive(r, now));
}
@Entity("bbb_entitlement")
@Index(["customerId", "type", "resourceId"])
@Index(["resourceId", "type"])
@Index(["channelId"])
export class BbbEntitlement extends VendureEntity {
  constructor(input?: DeepPartial<BbbEntitlement>) {
    super(input);
  }

  /** The type of resource this entitlement grants access to */
  @Column({ type: "varchar" })
  type: EntitlementType;

  /** The ID of the specific resource (e.g. BbbScheduledSession.id) */
  @Column({ type: "varchar" })
  resourceId: string;

  /** Vendure Customer.id who is granted access */
  @Index()
  @Column({ type: "varchar" })
  customerId: string;

  /** How the entitlement was created — for audit and filtering */
  @Column({ type: "varchar", default: "purchase" })
  source: EntitlementSource;

  /** Optional: when access begins. null = immediate */
  @Column({ type: 'timestamp', nullable: true })
  validFrom: Date | null;

  /** Optional: when access expires. null = no expiration */
  @Column({ type: 'timestamp', nullable: true })
  validUntil: Date | null;

  /** Channel isolation — scalar FK to Channel.id (not junction table) */
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;

  // ─── Audit trail (W5 follow-up, approved 2026-10-05) ────────────────────────
  // New rows only — NO backfill. Stamped when the erasure flow expires the
  // entitlement (validUntil = now), and by the admin deleteBbbEntitlement
  // mutation, which DEACTIVATES (sets validUntil + stamp) instead of deleting
  // so "who revoked this student's access" stays answerable.

  /** User (ctx.activeUserId) who deactivated this entitlement; null = system erasure. */
  @Column({ type: "varchar", nullable: true })
  deactivatedByUserId: string | null;

  /** When the deactivation (expiry stamp) happened. */
  @Column({ type: "timestamp", nullable: true })
  deactivatedAt: Date | null;
}