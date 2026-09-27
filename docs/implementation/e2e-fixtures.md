# E2E Fixture Contract (Phase 8)

**Status:** COMPLETE — fixture layer implemented and live-verified 2026-09-27\
**Scope:** `scripts/e2e/` — the deterministic multi-tenant fixture layer used by the Phase 8 scenario suite\
**Canonical for:** what `E2EFixtureManifest` is, and what `verify.ts` is required to diff.

------------------------------------------------------------------------

## 1. Why this layer exists, and how it differs from its neighbours

Three verification layers exist in this repository and they are **not**
interchangeable. A claim must state which layer produced it.

| Layer | Location | Runtime shape | What only it can prove |
|---|---|---|---|
| Vitest specs | `src/plugins/**/__tests__/*.e2e-spec.ts` | In-process, real Postgres, one schema per suite | Domain/FSM/invariant behaviour against real SQL — but never HTTP binding, route mapping, or a session-authenticated external caller |
| Acceptance scripts | `scripts/verify/*.sh` | Real HTTP against a running server, shell assertions | End-to-end status codes and wiring on a live deployment (`adr-044-acceptance.sh`, `demo-flow.sh`, `free-basic-activation.sh`) |
| **Fixture layer** | `scripts/e2e/` | Real HTTP against a running server, **multi-tenant, manifest-driven** | That several tenants seeded with deliberately different commercial state are each reported correctly **and cannot see each other** (INV-001) |

The fixture layer exists because the first two cannot express the question Phase 8
asks: *is tenant A's reported state correct while tenant B's state is different?*
A single-tenant spec can pass while the channel scoping separating two tenants is
broken, because nothing in it ever resolves another tenant's row.

## 2. What exists today

Present — type-checks under `--strict`, but **not** covered by `npm run build`,
because `tsconfig.json` includes only `src/**/*.ts`. Run `tsc --noEmit` over the
directory explicitly when changing it:

- `scripts/e2e/graphql-client.ts` (120 lines) — `FixtureGraphQLClient` + `GraphQLFixtureError`.
- `scripts/e2e/auth.ts` (61 lines) — `loginSuperAdmin`, `loginTenantAdmin`, `loginShopCustomer`.
- `scripts/e2e/fixture-types.ts` (38 lines) — `E2ETenantFixture`, `E2EFixtureManifest`, `SubscriptionLifecycleState`, `MarketplaceVisibility`.
- `scripts/e2e/scenarios/` — the scenario files (currently only its README).

Absent, and required before the layer can run: the **seeder** (writes the
manifest), the **scenario files**, and **`verify.ts`** (the diff). See §7.

## 3. The fixture contract

A fixture is **plain recorded data**, never a re-derivation from code. If the
seeder created an id, the id goes in the manifest; `verify.ts` reads it from
there. Nothing on either side may recompute an expectation from the
implementation — that is how a broken implementation and its verifier drift
together.

```ts
interface E2ETenantFixture {
  label: string;                 // human-readable only, e.g. "Tenant A — Apex Academy"
  channelId: string;
  channelToken: string;
  admin: { email: string; password: string };
  instructor: { customerId: string; profileId: string };
  student: { customerId: string; email: string; password: string };
  bbbOrganizationId: string;
  expected: {
    subscription: 'active' | 'past_due' | 'pending_provider_auth' | 'cancelled';
    bbb: 'live_session' | 'scheduled_session' | 'no_session';
    marketplace: 'published' | 'unpublished';
  };
}

interface E2EFixtureManifest {
  createdAt: string;
  host: string;
  tenants: Record<string, E2ETenantFixture>;  // keyed by label slug: "tenant-a"
}
```

Rules that make the manifest usable as evidence:

1. **Keyed by label slug** (`tenant-a`, `tenant-b`, …) so a scenario can name a
   tenant *other* than the one it is acting as — this is what makes the
   cross-tenant probe in §4 possible.
2. **Every actor is a separate credential set** (admin, instructor, student) and
   gets its own client via `forNewActor()`. Sessions never bleed between tenants.
3. **`expected` is the only source of truth for assertions.** A scenario needing a
   fourth axis extends the type here first; it does not assert ad hoc.
4. **The manifest is a run artifact, not a fixture.** It is written to
   `scripts/e2e/.fixtures/manifest.json` (gitignored). Committing a manifest would
   freeze one person's local ids as an expectation.

## 4. What `verify.ts` must diff

For **each** tenant in the manifest, and once more **across** tenants:

- **`expected.subscription`** — observed through the tenant-scoped read model on
  the Admin API, with the session of *that* tenant's admin, and channel-scoped
  (`channelId` / channel token). The documented global exception
  (`organizationSubscriptions` — the platform view of which tenant is on which
  plan) may **not** satisfy a tenant-scoped assertion: it passes while scoping is
  broken. Observed lifecycle must equal `expected.subscription`, and `cancelled`
  must stay cancelled across a re-run (no resurrection).
- **`expected.bbb`** — `live_session` ⇒ a live/started session exists for that
  tenant's organization; `scheduled_session` ⇒ one is scheduled and not live;
  `no_session` ⇒ **neither**. Absence is itself the assertion, so an empty result
  must be shown to be a genuine empty result and not a masked rejection — the
  failure mode INV-015 exists for.
- **`expected.marketplace`** — `published` ⇒ the listing is reachable on the public
  storefront/marketplace surface for that channel; `unpublished` ⇒ it is **absent**
  there. A 200 with an empty page passes only when the manifest expects
  `unpublished`; it is never evidence for `published`.
- **Cross-tenant isolation (INV-001)** — using tenant A's session, request tenant
  B's recorded ids (`bbbOrganizationId`, `customerId`, `profileId`, or B's channel
  token). Every such read must fail or return nothing; a leak fails the run. This
  is the assertion the other two layers cannot make, and it is why the manifest
  records ids rather than slugs.

Failure semantics — no silent passes:

1. Any GraphQL error ⇒ **FAIL**, reported with the operation name. A rejection is
   never read as an empty result set.
2. Zero rows where `expected` implies rows ⇒ **FAIL**.
3. A missing manifest entry, or a missing axis ⇒ **FAIL**, not a skip.
4. `SKIP` is reserved for environment absence (no server reachable, a credential
   the environment does not hold) and must print the reason, mirroring the SKIP
   convention in `scripts/verify/adr-044-acceptance.sh`.
5. Exit non-zero if any check FAILed; `0` only when every check PASSed or
   explicitly SKIPped — mirroring `scripts/verify/demo-flow.sh` (`exit 1`).

Determinism: re-running the seeder for one label **refreshes** that tenant rather
than duplicating it, and `verify.ts` run twice against an unchanged system
produces an identical verdict.

## 5. Auth and client conventions (non-negotiable)

- Session auth is cookie-based through the `login` mutation with the
  `... on CurrentUser { id identifier }` / `... on ErrorResult { errorCode message }`
  selection — deliberately identical to `scripts/seed/seed-via-graphql.sh`, so a
  failure here means the login contract changed, not that this layer drifted from
  it.
- Channel scoping is the `vendure-token` header, set via `withChannelToken()`.
- **Hard rule:** every call either returns typed data or throws
  `GraphQLFixtureError`. `data?.foo?.items ?? []` appears nowhere in this layer or
  in anything built on it — that exact fallback is what let the Mandates /
  Payment-Attempts contract drift render as a clean empty table (INV-015).
- One client per actor; never share a session across tenants.

## 6. Non-goals

- **Not** provider-state verification: Razorpay and BBB-vendor side state is out
  of scope (the reason ADR-044 scenarios 12–13 remain SKIPped with manual
  instructions). This layer asserts platform-side state only.
- **Not** a replacement for the vitest e2e specs or `scripts/verify/*.sh`; it is
  the multi-tenant layer, used in addition to them.
- **Not** a load/soak harness, and not a demo seeding tool — that is
  `scripts/seed/`.

## 7. Phase 8 delivery and evidence

Phase 8 is delivered at commit `787c4c2` and was live-verified against `localhost:3000`.

| Evidence | Result |
|---|---|
| Seed | exit 0; tenant-a channel 32 with session 23 → SCHEDULED; tenant-b channel 33 with session 24 → DRAFT |
| Idempotent reseed | identical fixture ids/state; cancelled subscriptions are not resurrected |
| Verify | **16/16 PASS**, exit 0 |
| Isolation | bidirectional probes on recorded BBB/customer/profile ids and channel-token surface all rejected or returned nothing |
| Environment semantics | dead server → SKIP / exit 0; missing manifest → FAIL / exit 1 |
| Static gates | `typecheck:e2e` 0; `npm run build` 0; `verify:invariants` 100/100; working tree clean |

The fixture layer remains complementary to the Vitest and acceptance-script layers;
it does not replace them. Its manifest is a gitignored run artifact, and its
three-axis output should be cited as runtime evidence separately from code and
specification evidence.



