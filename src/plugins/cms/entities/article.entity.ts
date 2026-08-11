import { Asset, Channel, DeepPartial, VendureEntity, ChannelAware, EntityId, ID } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne } from 'typeorm';

/**
 * Note: kept single-language for v1. If BuyLits needs localized article
 * content later, migrate to a Translatable entity (see Vendure's
 * "Implementing Translatable" guide) — that's a breaking schema change,
 * so worth deciding up front if multi-language is on the near-term roadmap.
 */
@Entity()
export class Article extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<Article>) {
        super(input);
    }

    @Index()
    @Column({ nullable: true })
    channelId: string;

    @Index(['channelId', 'slug'], { unique: true })
    @Column()
    slug: string;

    @Column()
    title: string;

    @Column({ nullable: true })
    excerpt: string;

    @Column('text')
    body: string;

    @Index()
    @Column({ default: false })
    isPublished: boolean;

    @Column({ type: Date, nullable: true })
    publishedAt: Date | null;

    @ManyToOne(type => Asset, { nullable: true })
    featuredAsset?: Asset;

    @EntityId({ nullable: true })
    featuredAssetId?: ID;

    /** Simple tag list — simple-json avoids comma-in-tag corruption that simple-array has */
    @Column({ type: 'simple-json', nullable: true })
    tags?: string[];

    // ChannelAware: channel assignment via CmsChannelAssignmentPolicy (ADR-036).
    // Platform CMS (SuperAdmin) -> __default_channel__ only.
    // Tenant CMS (Tenant Admin) -> tenant channel only, never default.
    // See CmsChannelAssignmentPolicy.assign() for the two-class ownership model
    // that replaces the old assignToCurrentChannel() behaviour (BUG-031).
    @ManyToMany(type => Channel)
    @JoinTable()
    channels: Channel[];

}
