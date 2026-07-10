import { Asset, Channel, DeepPartial, VendureEntity, ChannelAware, EntityId, ID } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BannerPlacement } from '../types';

@Entity()
export class Banner extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<Banner>) {
        super(input);
    }

    @Column()
    title: string;

    @ManyToOne(type => Asset, { nullable: false, onDelete: 'RESTRICT' })
    image: Asset;

    @EntityId()
    imageId: ID;

    @Column({ nullable: true })
    linkUrl?: string;

    @Index()
    @Column('varchar')
    placement: BannerPlacement;

    /** Lower number = higher priority when multiple banners share a placement */
    @Column({ default: 0 })
    priority: number;

    @Index()
    @Column({ default: true })
    isActive: boolean;

    @Column({ type: Date, nullable: true })
    startsAt: Date | null;

    @Column({ type: Date, nullable: true })
    endsAt: Date | null;

    /**
     * Precomputed flag refreshed every minute by the banner-activator
     * ScheduledTask (BUG-015 / CMS-002). Replaces runtime date-range
     * comparisons in findActiveForPlacement().
     */
    @Index()
    @Column({ default: false })
    isCurrentlyActive: boolean;

    /** Scalar channelId for efficient direct queries (see DA-001) */
    @Index()
    @Column({ nullable: true })
    channelId: string;

    @ManyToMany(type => Channel)
    @JoinTable()
    channels: Channel[];

}
