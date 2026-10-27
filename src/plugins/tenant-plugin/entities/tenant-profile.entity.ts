import { Channel, DeepPartial, VendureEntity, EntityId, ID, ChannelAware } from '@vendure/core';
import { Column, Entity, ManyToMany, JoinTable, ManyToOne, JoinColumn, Index } from 'typeorm';

@Entity()
export class TenantProfile extends VendureEntity implements ChannelAware {
  constructor(input?: DeepPartial<TenantProfile>) {
    super(input);
  }

  @ManyToMany(() => Channel)
  @JoinTable()
  channels: Channel[];

  @Index()
  @Column('varchar', { length: 255 })
  channelId: ID;

  @Column('varchar')
  businessName: string;

  /**
   * Internal slug used for tenant identity and central marketplace routes
   * (e.g. /sellers/{tenantSlug}). Derived at registration from businessName,
   * unique, and IMMUTABLE after provisioning (no rename semantics exist).
   * Nullable only because the column post-dates existing profiles; every
   * newly registered tenant has one. This is NOT a hostname — no
   * {tenantSlug}.saa9vi.com mapping is provisioned from it.
   * This is the single slug source of truth — BbbOrganization.slug is
   * synchronized FROM this value, never independent (TenantRegisteredEvent).
   */
  @Index({ unique: true })
  @Column('varchar', { nullable: true })
  tenantSlug: string;

  @Column('varchar', { nullable: true })
  tagline: string;

  @EntityId({ nullable: true })
  logoAssetId: ID;

  @Column('varchar', { default: 'UTC' })
  timezone: string;

  @Column('varchar')
  contactEmail: string;

  @Column('varchar', { nullable: true, unique: true })
  customDomain: string;

  @Column('boolean', { default: false })
  onboardingComplete: boolean;
}
