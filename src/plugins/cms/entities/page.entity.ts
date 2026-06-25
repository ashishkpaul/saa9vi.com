import { Channel, DeepPartial, VendureEntity, ChannelAware } from '@vendure/core';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';
import { PageSection } from '../types';

@Entity()
export class Page extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<Page>) {
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
    metaDescription?: string;

    @Index()
    @Column({ default: false })
    isPublished: boolean;

    /**
     * 'simple-json' (rather than Postgres-only 'jsonb') so the column behaves
     * identically across the SQLite dev DB and Postgres prod DB — same
     * pattern as the rest of the BuyLits stack.
     */
    @Column('simple-json', { default: '[]' })
    sections: PageSection[];

    @ManyToMany(type => Channel)
    @JoinTable()
    channels: Channel[];

}
