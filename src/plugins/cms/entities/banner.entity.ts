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

    @ManyToOne(type => Asset)
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

    @ManyToMany(type => Channel)
    @JoinTable()
    channels: Channel[];

}
