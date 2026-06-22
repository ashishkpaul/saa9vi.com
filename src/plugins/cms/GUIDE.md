# BuyLits CMS Plugin Guide

This guide documents the architecture, data model, APIs, and extension points of the `CmsPlugin`. It is intended for developers working on the BuyLits storefront and for future plugin maintainers.

## Table of Contents

- [Overview](#overview)
- [Entities](#entities)
- [Services](#services)
- [Custom Fields](#custom-fields)
- [GraphQL API](#graphql-api)
  - [Admin API](#admin-api)
  - [Shop API](#shop-api)
- [Dashboard UI](#dashboard-ui)
- [Channel Strategy](#channel-strategy)
- [Extending the Plugin](#extending-the-plugin)
- [Troubleshooting & FAQ](#troubleshooting--faq)

## Overview

The CMS plugin adds headless content management to BuyLits. It is implemented as a standard Vendure plugin (`@VendurePlugin`) and exposes:

- **Articles** — long-form content with a featured image, tags, rich-text body, and publish date.
- **Banners** — time-bounded, placement-scoped promotions with image, link URL, priority, and active window.
- **Pages** — structured, section-based pages built from a JSON `sections` array (hero, rich text, product grid, article grid, banner slot).

All entities are **channel-aware**, so platform admins can publish content into one or more seller channels.

## Entities

### Article

| Field | Type | Notes |
|---|---|---|
| `slug` | `string` | Unique within a channel; used in storefront URLs. |
| `title` | `string` | |
| `excerpt` | `string?` | Short summary. |
| `body` | `text` | Full article body (HTML or rich text). |
| `isPublished` | `boolean` | Soft publish toggle. |
| `publishedAt` | `Date?` | Set automatically on first publish. |
| `featuredAsset` | `Asset?` | Featured image. |
| `featuredAssetId` | `ID?` | Direct asset reference. |
| `tags` | `string[]?` | Simple-array tags. |
| `channels` | `Channel[]` | Channel association. |

### Banner

| Field | Type | Notes |
|---|---|---|
| `title` | `string` | |
| `image` | `Asset` | Required banner image. |
| `imageId` | `ID` | |
| `linkUrl` | `string?` | Optional destination. |
| `placement` | `BannerPlacement` | Where the banner renders (homepage hero, sidebar, etc.). |
| `priority` | `number` | Lower number = higher priority when multiple banners share a placement. |
| `isActive` | `boolean` | Master on/off switch. |
| `startsAt` / `endsAt` | `Date?` | Date window; banner is only live when `now` is within the window (or window is open-ended). |
| `channels` | `Channel[]` | |

### Page

| Field | Type | Notes |
|---|---|---|
| `slug` | `string` | Used in storefront routes. |
| `title` | `string` | |
| `metaDescription` | `string?` | SEO description. |
| `isPublished` | `boolean` | |
| `sections` | `PageSection[]` | JSON array of section blocks. |
| `channels` | `Channel[]` | |

#### Page sections (JSON discriminated union)

See `src/plugins/cms/types.ts` for the authoritative TypeScript union.

| Type | Config shape | Purpose |
|---|---|---|
| `hero` | `{ headline, subheadline?, assetId?, ctaLabel?, ctaUrl? }` | Full-width hero banner. |
| `richText` | `{ html: string }` | Arbitrary HTML block. |
| `productGrid` | `{ title?, collectionId?, limit }` | Curated product collection. |
| `articleGrid` | `{ title?, articleIds: ID[] }` | Linked articles. |
| `bannerSlot` | `{ placement: BannerPlacement }` | Injects a dynamic banner by placement. |

## Services

All services live under `src/plugins/cms/services/` and follow Vendure service-layer conventions:

- Constructed by NestJS.
- Receive `TransactionalConnection`, `ListQueryBuilder`, and `ChannelService`.
- Enforce **channel-scoped** data access via `findOneInChannel` and `getEntityOrThrow(... { channelId })`.
- Enforce **slug uniqueness within a channel** with dedicated private query builders (`assertSlugIsUnique`).
- Return standardized delete responses: `{ result: 'DELETED' as const }`.

### ArticleService

Key methods:

- `findAll(ctx, options?)`
- `findOne(ctx, id)`
- `create(ctx, input)`
- `update(ctx, input)`
- `delete(ctx, id)`

Notable behavior:

- Sets `publishedAt` automatically when `isPublished` transitions to `true`.
- Supports assigning to extra channels via `input.channelIds`.

### BannerService

Key methods:

- `findAll(ctx, options?)`
- `findOne(ctx, id)`
- `findActiveForPlacement(ctx, placement)` — shop-specific helper that returns only active banners within their date window, ordered by `priority ASC`.
- `create(ctx, input)`
- `update(ctx, input)`
- `delete(ctx, id)`

### PageService

Key methods:

- `findAll(ctx, options?)`
- `findOne(ctx, id)`
- `findBySlug(ctx, slug)` — shop-specific helper returning only published pages for a slug in the active channel.
- `create(ctx, input)`
- `update(ctx, input)`
- `delete(ctx, id)`

Notable behavior:

- Validates `sections` defensively: each section must have `id` and `type`, and IDs must be unique.

## Custom Fields

The plugin uses **Vendure-managed custom fields**. The three CMS entities register empty custom-field declarations in `vendure-config.ts`:

```ts
customFields: {
  Article: [],
  Banner: [],
  Page: [],
}
```

Vendure then auto-generates the `customFields` column and GraphQL field at runtime. This removes the need to manually define `customFields` columns in each entity and eliminates the “already has a customFields field defined” startup warning.

To add actual custom fields later, extend the arrays:

```ts
customFields: {
  Article: [
    { name: 'authorName', type: 'string' },
    { name: 'readTimeMinutes', type: 'int' },
  ],
  // ...
}
```

## GraphQL API

### Admin API

Mutations are wrapped in `@Transaction()` and protected by `@Allow(...)` with `CrudPermissionDefinition` groups (`CmsArticle`, `CmsBanner`, `CmsPage`).

**Example: create article**

```graphql
mutation CreateArticle($input: CreateArticleInput!) {
  createArticle(input: $input) { id slug title }
}
```

**Example: list pages**

```graphql
query ListPages($options: CmsPageListOptions) {
  cmsPages(options: $options) {
    items { id slug title isPublished }
    totalItems
  }
}
```

### Shop API

Read-only, public queries. All results are implicitly channel-scoped, and article/page queries filter to `isPublished: true`.

**Example: public article by slug**

```graphql
query Article($slug: String!) {
  cmsArticle(slug: $slug) { id title body featuredAsset { preview } }
}
```

**Example: active banners for a placement**

```graphql
query Banners($placement: BannerPlacement!) {
  cmsBanners(placement: $placement) { id title image { preview } linkUrl }
}
```

### Type naming

- Admin page type is exposed as `CmsPage` (not `Page`) to avoid collision with core Vendure admin types.
- The underlying TypeScript entity remains `Page`; only the GraphQL type is prefixed.

## Dashboard UI

Defined in `src/plugins/cms/dashboard/index.tsx`. The extension registers:

- **Routes**: article list/detail, banner list/detail, page list/detail.
- **Navigation**: a `CMS` section in the admin sidebar.

### List pages

Use Vendure’s `ListPage` and `PaginatedListDataTable` with generated filter/sort columns. List queries are anchored to the auto-generated `XxxListOptions` stubs.

### Detail pages

Use `useDetailPage` with server-side queries keyed to `cmsPage(id: ID!)` (prefixed to match the admin schema). The page detail page includes:

- Publish status toggle
- Channel multi-select
- Title / slug / meta description form
- Section editor (`PageSectionEditor`)
- `CustomFieldsPageBlock` for Vendure-managed custom fields (`entityType="CmsPage"`)

## Channel Strategy

All three entities implement `ChannelAware` and use a many-to-many join table (`*_channels_channel`). The services:

- **Auto-assign** the newly created entity to the admin’s current channel via `channelService.assignToCurrentChannel`.
- **Optionally assign** to extra channels when `input.channelIds` is provided.
- **Query scope** is the active channel (`ctx.channelId`) so shop queries never leak cross-channel content.

Slug uniqueness is enforced per channel at the service layer because the DB-level unique constraint cannot span a many-to-many join table cleanly.

## Extending the Plugin

### Adding a new entity type

1. Create the entity class extending `VendureEntity` + `ChannelAware`.
2. Add a corresponding service with CRUD methods.
3. Add GraphQL types in `api-extensions.ts` under `sharedTypeExtensions` if both admin and shop need them.
4. Add resolvers in `api/cms-admin.resolver.ts` and/or `api/cms-shop.resolver.ts`.
5. Register the entity, service, and resolvers in `cms.plugin.ts`.
6. Add custom permissions via `CrudPermissionDefinition`.
7. Add dashboard routes or extend existing ones.
8. Generate a migration with `npx vendure migrate --generate <name>`.

### Adding fields to an existing entity

1. Update the entity class.
2. Update/create API input and type definitions.
3. Update service methods.
4. Update resolvers and dashboard forms.
5. Generate a migration.

## Next.js Storefront Integration

This section explains how to consume the CMS Shop API from a Next.js storefront using the standard Vendure Connect patterns.

### Prerequisites

- Node.js 18+
- Next.js 13/14 with App Router
- `@vendure/connect` installed in the storefront
- The storefront must be able to reach the Vendure server’s `/shop-api` endpoint

### Create a Vendure Connect client

Use the standard `createServerClient` helper in server components, route handlers, or server actions.

```ts
// src/lib/vendure.ts
import { createServerClient } from '@vendure/connect';

export const shopClient = () =>
  createServerClient({
    apiUrl: process.env.VENDURE_SHOP_API_URL ?? 'http://localhost:3000/shop-api',
    channel: process.env.VENDURE_CHANNEL ?? 'default',
    // Required if your storefront authenticates customers:
    // storage: cookies(), // or your session/JWT mechanism
  });
```

### Fetching CMS content

All CMS Shop queries are public. You do not need to authenticate customers to read articles, pages, or banners.

#### Article by slug

```tsx
// app/blog/[slug]/page.tsx
import { shopClient } from '@/lib/vendure';
import { gql } from '@/gql';

const ARTICLE_QUERY = gql(`
  query Article($slug: String!) {
    cmsArticle(slug: $slug) {
      id
      title
      excerpt
      body
      publishedAt
      featuredAsset { preview }
      tags
    }
  }
`);

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const client = shopClient();
  const data = await client.query(ARTICLE_QUERY, { slug: params.slug });
  const article = data.cmsArticle;

  if (!article) return <div>Not found</div>;

  return (
    <article>
      <h1>{article.title}</h1>
      {article.featuredAsset && <img src={article.featuredAsset.preview} alt="" />}
      <div dangerouslySetInnerHTML={{ __html: article.body }} />
    </article>
  );
}
```

#### Page by slug (used for CMS-driven routes)

```tsx
// app/[slug]/page.tsx
import { shopClient } from '@/lib/vendure';

const PAGE_QUERY = gql(`
  query Page($slug: String!) {
    cmsPage(slug: $slug) {
      id
      title
      metaDescription
      isPublished
      sections
      channels { code }
    }
  }
`);

export default async function DynamicPage({ params }: { params: { slug: string } }) {
  const client = shopClient();
  const { cmsPage } = await client.query(PAGE_QUERY, { slug: params.slug });

  if (!cmsPage) return <div>Not found</div>;

  return (
    <section>
      <h1>{cmsPage.title}</h1>
      <PageRenderer sections={cmsPage.sections} />
    </section>
  );
}
```

#### Banners by placement

```tsx
// app/layout.tsx (or a BannerSlot component)
import { shopClient } from '@/lib/vendure';

const BANNERS_QUERY = gql(`
  query Banners($placement: BannerPlacement!) {
    cmsBanners(placement: $placement) {
      id
      title
      image { preview }
      linkUrl
      priority
    }
  }
`);

export async function BannerSlot({ placement }: { placement: 'HOMEPAGE_HERO' | 'SIDEBAR' }) {
  const client = shopClient();
  const { cmsBanners } = await client.query(BANNERS_QUERY, { placement });
  const sorted = cmsBanners.sort((a, b) => a.priority - b.priority);

  if (!sorted.length) return null;

  return (
    <div>
      {sorted.map(banner => (
        <a key={banner.id} href={banner.linkUrl ?? '#'}>
          <img src={banner.image.preview} alt={banner.title} />
        </a>
      ))}
    </div>
  );
}
```

### Rendering page sections

Because `Page.sections` is a JSON discriminated union (`PageSection[]`), the storefront is responsible for rendering each block type. Use the `type` field to branch:

```tsx
// components/page-renderer.tsx
import { BannerSlot } from '@/components/banner-slot';
import { shopClient } from '@/lib/vendure';

export async function PageRenderer({ sections }: { sections: PageSection[] }) {
  return (
    <>
      {sections
        .filter(s => s.enabled)
        .sort((a, b) => a.order - b.order)
        .map(section => {
          switch (section.type) {
            case 'hero':
              return <HeroBlock key={section.id} config={section.config} />;
            case 'richText':
              return <RichTextBlock key={section.id} html={section.config.html} />;
            case 'productGrid':
              return <ProductGridBlock key={section.id} config={section.config} />;
            case 'articleGrid':
              return <ArticleGridBlock key={section.id} config={section.config} />;
            case 'bannerSlot':
              return <BannerSlotBlock key={section.id} config={section.config} />;
            default:
              return null;
          }
        })}
    </>
  );
}
```

### Channel awareness

The Shop API automatically scopes queries to the channel sent in the request header. In Next.js server components, set the channel when creating the client:

```ts
const client = shopClient();
// Override per-request if needed:
// client.<SECRET_79b0550c>('channel', 'seller-1');
```

If your storefront serves multiple seller storefronts, derive the channel from the request hostname or subdomain and pass it into the Connect client. The CMS plugin’s `PageService.findBySlug()` and `BannerService.findActiveForPlacement()` both filter by `ctx.channelId`, so different channels see different CMS content.

### Navigation / menus

If you want CMS pages to appear in the storefront navigation, query a list of published pages and build menu items:

```ts
const PAGES_QUERY = gql`
  query Pages {
    cmsPages(options: { take: 100 }) {
      items {
        id
        slug
        title
      }
    }
  }
`;

const { cmsPages } = await client.query(PAGES_QUERY, {});
const menuItems = cmsPages.items.map(p => ({ href: `/${p.slug}`, label: p.title }));
```

### Caching strategy

CMS content changes infrequently. Recommended Next.js caching:

- **`generateStaticParams`** — pre-render known slugs at build time where applicable.
- **`revalidate`** — use Next.js ISR when fetching CMS data to keep the storefront fresh without hitting the API on every request.
- **`fetch`** options from Next.js cache controls work because `@vendure/connect` is built on GraphQL tagged templates compatible with standard `fetch`.

Example:

```ts
const data = await client.query(PAGE_QUERY, { slug: params.slug }, {
  next: { revalidate: 60 },
});
```

### Pre-rendering CMS routes with `generateStaticParams`

Use `generateStaticParams` in pages that are keyed by slug so Next.js can pre-build them at deploy time instead of rendering on first request.

```ts
// app/blog/[slug]/page.tsx
import { shopClient } from '@/lib/vendure';
import { gql } from '@/gql';

const ARTICLES_QUERY = gql`
  query Articles($options: ArticleListOptions) {
    cmsArticles(options: $options) {
      items { slug }
    }
  }
`;

export async function generateStaticParams() {
  const client = shopClient();
  const { cmsArticles } = await client.query(ARTICLES_QUERY, { options: { take: 1000 } });
  return cmsArticles.items.map(a => ({ slug: a.slug }));
}
```

The same pattern applies to pages (`app/[slug]/page.tsx`) if you’re using dynamic CMS pages for routes.

## Troubleshooting & FAQ

**Q: Why is the type prefixed `CmsPage` instead of `Page`?**
A: Vendure’s admin schema already defines a `Page` type. Prefixing avoids ambiguity and query-name collisions.

**Q: Why does the page list use `cmsPages` instead of `pages`?**
A: Same reason as above — the prefixed query name avoids admin-schema collisions and matches the shop API’s `cmsPage` naming.

**Q: Why are `customFields` declared in `vendure-config.ts` and not in entities?**
A: Vendure auto-generates the `customFields: JSON` column and GraphQL field from config. Manually declaring the column in entities causes a startup warning about duplicate definitions.

**Q: Why do list option stubs need at least one field?**
A: Vendure validates that `input XxxListOptions` defines at least one field before generating filter/sort/pagination fields at runtime.

**Q: How do I add a new banner placement?**
A: Add a member to `BannerPlacement` in `src/plugins/cms/types.ts`, then use it in entity/mutation input.

**Q: How do I add a new page section type?**
A: Add a member to the `PageSection` discriminated union in `src/plugins/cms/types.ts`, then update `validateSections` in `PageService` if needed.

**Q: How should the Next.js storefront consume CMS data?**
A: Use `@vendure/connect` `createServerClient` in server components or route handlers, call `cmsArticle`, `cmsPage`, `cmsBanners`, and `cmsPages` from the Shop API, and render the JSON `sections` array with a section renderer.
