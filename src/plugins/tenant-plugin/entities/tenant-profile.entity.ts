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
