import { Channel, DeepPartial, VendureEntity, EntityId, ID } from '@vendure/core';
import { Column, Entity, ManyToOne, JoinColumn, Index } from 'typeorm';

@Entity()
export class TenantProfile extends VendureEntity {
  constructor(input?: DeepPartial<TenantProfile>) {
    super(input);
  }

  @ManyToOne(() => Channel)
  @JoinColumn()
  channel: Channel;

  @Index()
  @Column()
  channelId: string;

  @Column({ unique: true })
  businessName: string;

  @Column({ nullable: true })
  tagline: string;

  @EntityId({ nullable: true })
  logoAssetId: ID;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column()
  contactEmail: string;

  @Column({ default: false })
  onboardingComplete: boolean;
}