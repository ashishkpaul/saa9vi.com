import { ID } from '@vendure/core';

/**
 * Where a Banner can be rendered on the storefront. Add new placements here
 * as new slots are built into the Next.js storefront.
 */
export enum BannerPlacement {
    HOMEPAGE_HERO = 'HOMEPAGE_HERO',
    HOMEPAGE_STRIP = 'HOMEPAGE_STRIP',
    CATEGORY_TOP = 'CATEGORY_TOP',
    SIDEBAR = 'SIDEBAR',
    CHECKOUT_PROMO = 'CHECKOUT_PROMO',
}

/**
 * Discriminated union describing a single block inside a Page's `sections`
 * JSON column. Kept as JSON (rather than a relational PageSection entity)
 * deliberately: section shape evolves quickly as the storefront grows, and a
 * relational approach would mean an entity + API extension + migration for
 * every new block type. The trade-off is that section content isn't
 * individually queryable/filterable server-side — acceptable here since the
 * storefront always fetches a Page wholesale by slug+channel.
 */
export type PageSection =
    | HeroSection
    | RichTextSection
    | ProductGridSection
    | ArticleGridSection
    | BannerSlotSection;

interface PageSectionBase {
    /** Stable client-generated id (uuid), used as React key + for reordering */
    id: string;
    order: number;
    /** Optional per-section visibility toggle without removing it */
    enabled: boolean;
}

export interface HeroSection extends PageSectionBase {
    type: 'hero';
    config: {
        headline: string;
        subheadline?: string;
        assetId?: ID;
        ctaLabel?: string;
        ctaUrl?: string;
    };
}

export interface RichTextSection extends PageSectionBase {
    type: 'richText';
    config: {
        html: string;
    };
}

export interface ProductGridSection extends PageSectionBase {
    type: 'productGrid';
    config: {
        title?: string;
        collectionId?: ID;
        limit: number;
    };
}

export interface ArticleGridSection extends PageSectionBase {
    type: 'articleGrid';
    config: {
        title?: string;
        articleIds: ID[];
    };
}

export interface BannerSlotSection extends PageSectionBase {
    type: 'bannerSlot';
    config: {
        placement: BannerPlacement;
    };
}
