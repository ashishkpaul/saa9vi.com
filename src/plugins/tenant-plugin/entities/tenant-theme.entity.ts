import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * ADR-043: Tenant Storefront Theming Is Tenant Data, Not Code.
 *
 * TenantTheme stores the L1 controlled-theme configuration for a tenant's
 * storefront. It is scoped to exactly one channelId (INV-025) and versioned
 * for deterministic rollback.
 *
 * L1 (this entity): colour palette, logo asset reference, font family from
 *   a curated list. No arbitrary CSS.
 * L3 (future): constrained custom CSS, gated by plan.customCssEnabled.
 *
 * Lifecycle (ADR-043 L1):
 *   draft --publish--> active --(publish the next version)--> archived
 *
 * Only ONE theme row per channel may have status='active' at any time. This is
 * enforced by PostgreSQL (partial unique index below), NOT merely by service
 * logic — see INV-025. A losing concurrent publisher therefore fails closed
 * with a 23505 instead of silently leaving two active themes.
 *
 * Version history is immutable: a version may only be edited while it is a
 * 'draft'. Editing the live theme means creating a new draft
 * (createDraftFromVersion) and publishing it. That is what makes rollback
 * deterministic — every archived row still holds exactly the values that were
 * live when it was active.
 */
@Entity('tenant_theme')
@Index(['channelId', 'version'], { unique: true })
/**
 * INV-025: at most one ACTIVE theme per channel, arbitrated by the database.
 * Mirrors the house pattern used by OrganizationSubscription
 * (`UNIQUE(channelId) WHERE status != 'cancelled'`).
 */
@Index(['channelId'], { unique: true, where: '"status" = \'active\'' })
export class TenantTheme extends VendureEntity {
  constructor(input?: DeepPartial<TenantTheme>) {
    super(input);
  }

  /**
   * Tenant scope. Set from the authoritative channel at creation time (INV-001).
   * Immutable after creation.
   */
  @Index()
  @Column('varchar')
  channelId: string;

  /**
   * Monotonically increasing version number per channel.
   *
   * Allocated when a draft is created — MAX(version) + 1 computed inside the
   * insert transaction while holding a per-channel advisory lock, so two
   * concurrent drafts cannot collide on UNIQUE(channelId, version).
   *
   * NOT incremented on save. A version is immutable once published, so the
   * number identifies a fixed set of values and rollback is deterministic.
   */
  @Column('int', { default: 1 })
  version: number;

  /**
   * Lifecycle status.
   * - 'active':   currently applied to the tenant storefront
   * - 'draft':    staged but not yet applied
   * - 'archived': a previous active version, retained for rollback
   *
   * Invariant: exactly one 'active' row per channelId at any time.
   */
  @Column('varchar', { default: 'draft' })
  status: 'active' | 'draft' | 'archived';

  // ── L1 Colour Palette ─────────────────────────────────────────────────────

  /** Brand primary colour (hex, e.g. '#2563EB'). */
  @Column('varchar', { length: 9, nullable: true })
  primaryColor: string | null;

  /** Brand secondary colour. */
  @Column('varchar', { length: 9, nullable: true })
  secondaryColor: string | null;

  /** Accent / highlight colour. */
  @Column('varchar', { length: 9, nullable: true })
  accentColor: string | null;

  /** Page/card background colour. */
  @Column('varchar', { length: 9, nullable: true })
  backgroundColor: string | null;

  /** Primary text colour. */
  @Column('varchar', { length: 9, nullable: true })
  textColor: string | null;

  // ── L1 Typography ─────────────────────────────────────────────────────────

  /**
   * Font family selection from the curated set defined in ALLOWED_FONTS.
   * Stored as a key (e.g. 'inter', 'roboto') — the storefront maps this
   * to the actual CSS font-family declaration. Arbitrary font URLs are not
   * accepted (ADR-043 security boundary).
   */
  @Column('varchar', { nullable: true })
  fontFamily: string | null;

  // ── L1 Branding ──────────────────────────────────────────────────────────

  /**
   * Vendure Asset ID of the tenant's logo image.
   * Must resolve to an asset owned by this channel.
   */
  @Column('varchar', { nullable: true })
  logoAssetId: string | null;

  /**
   * Optional display name override for the storefront header.
   * Falls back to TenantProfile.businessName if null.
   */
  @Column('varchar', { nullable: true })
  displayName: string | null;
}

/**
 * Curated font family keys accepted for L1 theming.
 * The storefront maps these to system/web-safe font stacks.
 * Arbitrary Google Fonts URLs or external font loading are not accepted.
 */
export const ALLOWED_FONTS = [
  'inter',
  'roboto',
  'open-sans',
  'lato',
  'poppins',
  'nunito',
  'source-sans-pro',
  'system',
] as const;

export type AllowedFont = (typeof ALLOWED_FONTS)[number];

/**
 * Validates a hex colour string: #RGB or #RRGGBB or #RRGGBBAA.
 */
export function isValidHexColor(value: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value);
}
