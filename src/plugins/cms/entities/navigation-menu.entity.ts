import type { DeepPartial } from "@vendure/common/lib/shared-types";
import { Channel, ChannelAware, VendureEntity } from "@vendure/core";
import { Column, Entity, Index, JoinTable, ManyToMany } from "typeorm";

export interface NavigationMenuItem {
    id: string;
    label: string;
    url: string;
    order: number;
    openInNewTab?: boolean;
}

/**
 * Navigation menu for an academy's storefront header/footer.
 *
 * One current menu per channel (unique channelId). Each menu contains
 * an ordered list of items stored as JSONB.
 *
 * Channel-scoped: a navigation menu belongs to one tenant channel.
 */
@Entity("navigation_menu")
@Index(["channelId"], { unique: true })
export class NavigationMenu extends VendureEntity implements ChannelAware {
    constructor(input?: DeepPartial<NavigationMenu>) {
        super(input);
    }

    /** Display name for admin identification (e.g. "Main Header"). */
    @Column()
    name: string;

    /** Ordered list of menu items. */
    @Column({ type: "jsonb", default: "[]" })
    items: NavigationMenuItem[];

    @Column({ default: true })
    isActive: boolean;

    /** Owning tenant channel (unique — one active menu per channel). */
    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];

    /** Denormalized tenant scope (ADR-003 scalar-only exception). */
    @Column()
    channelId: string;
}
