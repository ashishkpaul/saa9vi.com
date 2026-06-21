import { Channel, DeepPartial, VendureEntity, ChannelAware } from '@vendure/core';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
import { PageSection } from '../types';

export class PageCustomFields {}

@Entity()
export class Page extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<Page>) {
        super(input);
    }

    @Column()
    slug: string;

    @Column()
    title: string;

    @Column({ nullable: true })
    metaDescription?: string;

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

    @Column(type => PageCustomFields)
    customFields: PageCustomFields;
}
