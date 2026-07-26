# Glossary

> **Purpose:** Define every domain term used across the Saa9vi platform. New terms should be added here before being used in any other document.

| Term | Meaning |
|---|---|
| **Channel** | Vendure tenant boundary. Every entity that is tenant-scoped is scoped to a Channel. |
| **Tenant** | A business/academy represented by a Vendure Channel. Has a `TenantProfile`, `BbbOrganization`, and optionally a `Seller`. |
| **TenantProfile** | Branding and contact information for a tenant. 1:1 with Channel. |
| **Seller** | Vendure core entity representing a seller in a marketplace context. Created during tenant registration. |
| **BbbOrganization** | Live meeting organization for a tenant. Owns rooms, memberships, capacity grants, and scheduled sessions. 1:1 with Channel. |
| **BbbRoom** | Persistent meeting container. Can be linked to a product variant for commercial access, or have `productVariantId = null` for internal/staff rooms. |
| **BbbScheduledSession** | A planned occurrence in a room with a start time, end time, price, and capacity. The commercial product entity — trainers sell scheduled time slots. |
| **BbbMeeting** | A runtime BBB instance. Provisioned on demand when someone joins a room. Has a state machine (Pending → Provisioning → Active → Completed/Stale/Failed). |
| **BbbOrganizationMembership** | Internal moderator/staff access to an organization. Roles: `org_admin`, `moderator`, `staff`. |
| **BbbEntitlement** | Participant access grant after trial or purchase. Types: `bbb_session` (session-scoped), `bbb_room` (room-scoped). The ADR-targeted access primitive. |
| **BbbEnrollment** | Legacy room-access mechanism. Being replaced by `BbbEntitlement`. |
| **BbbCapacityGrant** | Prepaid or internal meeting minutes. Source types: `order`, `subscription`, `internal_overhead`, `wallet`. |
| **BbbUsageLedger** | Immutable billing facts. Append-only rows recording consumed meeting minutes. |
| **BbbWebhookEvent** | Persisted BBB webhook event. Follows persist-before-process pattern. |
| **BbbTrialRegistration** | Records a student's registration for a free trial session. |
| **BbbProductAccess** | Maps a ProductVariant to a BbbRoom for fulfillment. |
| **Capacity Grant** | Prepaid block of meeting minutes. The billing unit for BBB usage. |
| **Entitlement** | Access grant. The single gate for all paid content access. |
| **Marketplace** | Cross-channel discovery layer. Platform-level Elasticsearch indices for sessions and instructors. Does not transact — redirects to tenant storefronts. |
| **Marketplace Commission** | Stream 2 revenue. A percentage of marketplace-originated orders, controlled by `MARKETPLACE_COMMISSION_PERCENT` env var. |
| **CommissionLedger** | Append-only ledger for marketplace commission rows. Always writes a row per marketplace order, even at 0% ($0-row pattern). |
| **AdWallet** | Prepaid advertising wallet per tenant. Topped up via Juspay. |
| **AdSpendLedger** | Append-only ledger for ad spend events (impression, click, conversion). |
| **Stream 1** | Tenant billing — BBB usage + portal/hosting. Usage-driven via `BbbCapacityGrant`/`BbbUsageLedger`. Always on. |
| **Stream 2** | Marketplace commission — percentage of marketplace orders. Controlled by `MARKETPLACE_COMMISSION_PERCENT`. |
| **Stream 3** | Advertising — sponsored listings and marketplace banners. Opt-in, tenant-initiated via `AdWallet`. |
| **INV-001** | Channel = Tenant. One identity system. |
| **INV-002** | Every billing fact is an immutable ledger row. |
| **INV-003** | One access-control system via Entitlement. |
| **INV-004** | Webhooks are persisted before processing. |
| **INV-008** | Business logic lives in Vendure. The storefront is a renderer. |
| **INV-009** | Marketplace indices are read projections. |
| **INV-012** | Capacity intelligence is advisory. Meetings are never blocked for capacity reasons. |
| **DL-030** | CommissionLedger $0-row pattern — always write a row per marketplace order, even at 0%. |
| **BbbPlatformCapacityPolicy** | ⚠️ Proposed — see ADR-031. Not yet implemented. Platform-level BBB capacity limits controlled by Portal Admin. Current mechanism: `BbbOrganization.maxParticipantsPerMeeting` (single mutable integer). |
| **Platform infrastructure capacity** | ⚠️ Proposed — see ADR-031. BBB server load and concurrent participant limits. Currently a single mutable integer per organization. |
| **Academy commercial capacity** | How many customers can buy a product. Controlled by Tenant Admin via `ProductVariant.stockLevel`. |
| **Session enrollment capacity** | How many students can attend a scheduled session. Controlled by Tenant Admin via `BbbScheduledSession.maxAttendees`. |
| **INV-014** | BBB infrastructure capacity is a single mutable integer per organization (current). |
| **INV-015** | ⚠️ Proposed — see ADR-031. BBB infrastructure capacity is platform-controlled via `BbbPlatformCapacityPolicy`. |
