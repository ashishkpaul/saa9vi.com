import { Channel, Customer, DeepPartial, VendureEntity, EntityId, ID } from '@vendure/core';
import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';

@Entity()
@Index(['channelId', 'slug'], { unique: true })
export class InstructorProfile extends VendureEntity {
  constructor(input?: DeepPartial<InstructorProfile>) {
    super(input);
  }

  @ManyToOne(() => Channel)
  @JoinColumn()
  channel: Channel;

  @Index()
  @Column()
  channelId: string;

  @ManyToOne(() => Customer)
  @JoinColumn()
  customer: Customer;

  @Index()
  @Column()
  customerId: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Customer;

  @Column({ nullable: true })
  createdById: string;

  @Index()
  @Column()
  slug: string;

  @Column()
  fullName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @EntityId({ nullable: true })
  photoAssetId: ID;

  @Column({ nullable: true })
  credentials: string;

  @Column({ type: 'simple-json', default: '[]' })
  expertiseAreas: string[];

  @Column({ default: 0 })
  displayOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isPublic: boolean;
}