import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { VendureEntity } from "@vendure/core";
import { Column, Entity, Index, ManyToOne } from "typeorm";
import { BbbOrganization } from "./bbb-organization.entity";

/**
 * A reusable session template that can generate multiple BbbScheduledSession
 * instances in a single mutation (recurring/series support).
 *
 * The template itself is never booked or started — it is purely a factory.
 * Each generated session is an independent DRAFT BbbScheduledSession that
 * goes through the normal publish → start lifecycle.
 *
 * Recurrence is modelled as a fixed set of ISO 8601 datetime strings rather
 * than an RRULE, keeping the logic simple and auditable. The caller supplies
 * the specific occurrence times; the template supplies the shared defaults
 * (title, trainer, tags, visibility, productVariantId).
 */
@Entity("bbb_session_template")
export class BbbSessionTemplate extends VendureEntity {
  constructor(input?: DeepPartial<BbbSessionTemplate>) {
    super(input);
  }

  /** Human-readable template name (not the session title). */
  @Column()
  name: string;

  /** Default title applied to each generated session. */
  @Column()
  defaultTitle: string;

  /** Default trainer (BbbOrganizationMember.id) applied to generated sessions. */
  @Column({ type: "varchar", nullable: true })
  defaultTrainerId: string | null;

  /** Default subject tags. */
  @Column({ type: "simple-array", nullable: true })
  defaultSubjectTags: string[] | null;

  /** Default visibility applied to generated sessions. */
  @Column({ default: "PRIVATE" })
  defaultVisibility: string;

  /**
   * Default session duration in minutes.
   * When generating sessions the caller provides startTime per occurrence;
   * endTime = startTime + durationMinutes.
   */
  @Column({ default: 60 })
  durationMinutes: number;

  /** Optional: link generated sessions to a Vendure product variant. */
  @Column({ type: "varchar", nullable: true })
  productVariantId: string | null;

  /** Owning organization. */
  @Index()
  @ManyToOne(() => BbbOrganization, (org) => org.id, { nullable: false })
  organization: BbbOrganization;

  /**
   * Denormalized FK — physically integer in DB (matches bbb_organization.id
   * SERIAL). TypeScript model uses string for consistency with the rest of
   * the BBB plugin (String(org.id) at write time).
   */
  @Column()
  organizationId: string;

  /** Denormalized channel scope (INV-001). */
  @Index()
  @Column({ type: "varchar", nullable: true })
  channelId: string | null;
}
