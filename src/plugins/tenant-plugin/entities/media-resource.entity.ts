import { Channel, DeepPartial, VendureEntity, EntityId, ID } from '@vendure/core';
import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';

export type MediaResourceType = 'youtube' | 'vimeo' | 'upload' | 'bbb_recording';
export type MediaResourceOwnerType = 'instructor' | 'session' | 'article' | 'page';

@Entity()
export class MediaResource extends VendureEntity {
  constructor(input?: DeepPartial<MediaResource>) {
    super(input);
  }

  @ManyToOne(() => Channel)
  @JoinColumn()
  channel: Channel;

  @Index()
  @Column()
  channelId: string;

  @Column({ type: 'varchar' })
  ownerType: MediaResourceOwnerType;

  @Column()
  ownerId: string;

  @Column({ type: 'varchar' })
  type: MediaResourceType;

  @Column()
  url: string;

  @Column()
  title: string;

  @EntityId({ nullable: true })
  thumbnailAssetId: ID;

  @Column({ default: 0 })
  displayOrder: number;

  @Column({ default: false })
  isFeatured: boolean;

  @Column({ default: true })
  isActive: boolean;
}