# Known Bugs

> **Purpose:** Track all confirmed bugs. Updated as bugs are found and fixed. When a bug is fixed, move it to release-notes.md.

---

## Active Bugs

**BUG-056 — `endedByUserId` was NULL for every human-ended meeting: the moderator's `endBbbMeeting` only asks BBB to end, and the actual `Completed` write runs later under a system ctx, so the audit column never recorded who ended — ✅ FIXED 2026-10-06 (`e91b457`; found 2026-10-05 by the W5 lifecycle trace).**

> **Status:** FIXED 2026-10-06 (`e91b457`, BBB audit follow-up 1/5).

**Severity:** Medium (audit-attribution gap: the column shipped in `1791209870396-bbb-audit-trail` but was never populated on the primary human path) · **Components:** `services/bbb-meeting.service.ts` (`endMeeting`), `services/bbb-meeting-lifecycle.service.ts` (`completeMeetingLifecycle`), `e2e/s7a-lifecycle-characterization.e2e-spec.ts` (`W5-11`)

**What the code did.** `endedByUserId` was stamped only inside `completeMeetingLifecycle` from `ctx.activeUserId`. The moderator's End path asks BBB to `/end` first and the `Completed` write happens afterwards under a system ctx (webhook, reconciliation, 24 h ceiling), so every human-ended meeting kept `NULL`.

**Fix (post-ack stamp + keep-first).** `endMeeting` stamps the requesting user **after** BBB acknowledges `/end` — a rejected `/end` throws before the write, so failed ends stay null — via a conditional `UPDATE … WHERE endedByUserId IS NULL` (first requester wins). `completeMeetingLifecycle` takes an explicit `endedByUserId` carrier and stamps only while the row is un-stamped (`options ?? ctx.activeUserId ?? null`), so later system completions can never overwrite the human.

**Evidence.** S7A `W5-11` (explicit carrier wins; system completion keeps the human; system-only stays null); failed-end-null is the throw-before-stamp path, reconcile-null covered by W5-4/6. Gates: build/lint/typecheck:e2e 0, invariants 100/100, S7A 19/19.

---

**BUG-057 — `BbbEntitlement` readers/writers assumed one row per natural key while `create()` was not concurrency-idempotent: duplicate rows made every `findOne`-then-decide path order-dependent, and a "successful" revoke could leave a live duplicate still granting access — ✅ FIXED 2026-10-06 (`33c7c96`; found 2026-10-05 by the W5 access-revocation trace, gap G2).**

> **Status:** FIXED 2026-10-06 (`33c7c96`, BBB audit follow-up 2/5).

**Severity:** High (access-control correctness: revoke silently ineffective against a duplicate; hasAccess/erase/list all order-dependent) · **Components:** `services/bbb-entitlement.service.ts` (`create`/`delete`), `entities/bbb-entitlement.entity.ts` (row helpers), `api/bbb-admin.resolver.ts` (`createBbbEntitlement`/`deleteBbbEntitlement`), `services/room-access.service.ts`, `services/learning-dashboard.service.ts`, `services/bbb-deletion.service.ts`, `dashboard/routes/entitlements/EntitlementsList.tsx`

**What the code did.** The natural key `(channelId, customerId, type, resourceId)` could hold several rows (racing non-idempotent creates), but hasAccess/erase/list did `findOne`-then-decide: whichever row TypeORM returned decided access, and revoke touched ONE row — a surviving unexpired duplicate kept granting access after the operator saw "revoked". The erasure flow's stamp write could also clobber a first writer.

**Fix (widened multi-row semantics).** hasAccess = **ANY** started+unexpired row across **all** rows of the key (shared `isEntitlementRowLive`/`anyEntitlementRowLive`); revoke = **ONE** schema-qualified (`repo.metadata.tablePath`) UPDATE deactivating **every** unexpired row with first-writer-wins `CASE` stamps — raw SQL must be schema-qualified: a bare table name resolves through `search_path` (`public` in the e2e suites) and silently updates 0 rows in the configured schema; grant = `pg_advisory_xact_lock` txn returning an existing unexpired row else INSERTing a **new** row (never reactivates — revoked rows keep their stamps as history); the erasure flow stamps only unstamped rows before expiring; the learning dashboard dedupes session rows; the entitlements list surfaces both rows (Revoked badge + re-grant). Cross-tenant revoke stays rejected.

**Evidence.** Isolation suite rewritten to the widened spec — revoke keeps stamps (first-writer-wins), re-grant inserts a new row, opposite insert orders allowed, two live rows → one revoke → denied, 4 concurrent grants converge to one live row, list shows both rows, cross-tenant revoke rejected: **110/110**. Gates: build/lint/typecheck:e2e 0, invariants 100/100, unit 249/249. ADR wording updated same day (`platform-adr.md` "Current status" + "Uniform access check"); trace doc G2 closed.

---

**BUG-058 — the e2e battery hardcoded `apiOptions.port` (3070–3101) with SHARED values (3076, 3077, 3078 ×2, 3079) under vitest's parallel forks pool, so two suites racing to listen failed inside `server.init()` with a raw EADDRINUSE and one suite was skipped wholesale — ✅ FIXED 2026-10-06 (`444e3dd`; observed 2026-10-05: the battery booted 3071 twice, customer-deletion skipped).**

> **Status:** FIXED 2026-10-06 (`444e3dd`, BBB audit follow-up 3/5).

**Severity:** Medium (test-infrastructure defect that silently drops a whole suite's signal and can masquerade as a flaky or passing battery) · **Components:** `src/test-utils/free-port.ts` (new), `src/test-utils/__tests__/free-port.spec.ts` (new), all 29 `*.e2e-spec.ts` suites, `webhook-signature-http` `WEBHOOK_PATH`

**What the code did.** Every suite hardcoded its port and `@vendure/testing` rethrows the raw Node error from `app.listen` — a collision surfaced as a cryptic `EADDRINUSE` inside `server.init()` (the customer-deletion suite carried a 3071/3072 workaround comment instead of a fix, and duplicate ports elsewhere meant the next parallel run could fail any pair).

**Fix.** `getFreePort()` binds `127.0.0.1:0`, reads the OS-assigned port and closes; `startOnFreePort()` replaces `server.init()` in `beforeAll` — allocates, writes `config.apiOptions.port`, re-points both GraphQL clients' URLs (they baked the placeholder port in at `createTestEnvironment` construction), boots, then **hard-fails on EADDRINUSE with an error naming the port** instead of a downstream skip. Top-level `await` is unavailable in this CJS project (TS1309) and the clients read the port synchronously — hence the wrapper-in-`beforeAll` pattern (`apiOptions.port: 0` is a never-bound placeholder). `webhook-signature-http` additionally rebuilds its `WEBHOOK_PATH` from the returned port.

**Evidence.** New `free-port.spec` (8 tests: allocatable/bindable/distinct ports, EADDRINUSE matcher, config+client rebind ordering, named-port hard-fail, untouched rethrow); isolation **110/110** and webhook-signature **8/8** running on OS-allocated ports; unit 257/257 at landing. The obsolete 3071/3072 workaround comment in the customer-deletion suite now points at the helper (history kept, dated 2026-10-05).

---

**BUG-053 — `tenantProfileId` was absent from `CreateBbbOrganizationInput` in the Admin SDL while the resolver arg type, the service input type, and the dashboard's "Tenant Profile ID" field all carried it, so the field could never be used — **FIXED 2026-10-01 (minimal option: surface removed, no schema change)**.**

> **Status:** FIXED 2026-10-01. Minimal option applied: `tenantProfileId` removed from the create dialog, the resolver arg type, the service input, and the provisioning listener's `create()` call. The entity column stays (nullable, never written, never read as a reference), so no migration was generated. `platform-adr.md:288-289` reworded: the tenant link is the channel itself (Channel=Tenant).

**Severity:** Medium (was a shipped contract lie — a rendered form field that hard-failed when used) · **Components:** `api/schema/bbb-admin.schema.ts:484-491` (`input CreateBbbOrganizationInput` — SDL already clean, confirmed unchanged, no migration generated), `api/bbb-admin.resolver.ts:86-93` (`AdminCreateBbbOrganizationInput` — field removed), `services/bbb-organization.service.ts:19-26,239` (`CreateBbbOrganizationInput`, `create()` — field removed), `dashboard/routes/organizations/OrganizationsList.tsx` (create-dialog field, state, and mutation arg removed), `listeners/bbb-tenant-provisioning.listener.ts` (`create()` call — arg removed), `entities/bbb-organization.entity.ts:25-26` (legacy nullable column retained, now never written)

**What the code did (before the fix).** The SDL's `CreateBbbOrganizationInput` declared only `channelId`, `slug`, `name`, `concurrentMeetingLimit`, `maxParticipantsPerMeeting`, `recordingEnabled` — `tenantProfileId` was **absent** (verified: `grep -n tenantProfileId api/schema/bbb-admin.schema.ts` → no match). The resolver arg type and the service input type both declared it as a **required, non-optional** `string`. The shipped dialog rendered an optional "Tenant Profile ID" `Input`, held it in `newTenantProfileId` state, and sent it inside the single `$input` object, so the two operator-visible outcomes were:

- **field filled in** → the variable carries a property the input type does not define → the mutation is rejected client-side with `Field "tenantProfileId" is not defined by type "CreateBbbOrganizationInput"` and the create never reaches the server;
- **field left blank** → `undefined` keys are dropped during variable serialization → the mutation succeeds and `create()` writes `tenantProfileId: undefined` → the column is `@Column({ nullable: true })`, so the row persists `tenantProfileId = NULL`.

Neither `tsc` nor `npm run build` reported anything: the value arrived as a GraphQL argument, so the required-`string` declarations were never checked against runtime emptiness.

**What was changed (minimal option, 2026-10-01).** `tenantProfileId` removed from `AdminCreateBbbOrganizationInput`, `CreateBbbOrganizationInput`, the listener's `create()` call, and the create dialog (field, state, and mutation argument). ADR wording fixed: the BBB plugin no longer "verifies `tenantProfileId` on org create" — the tenant link is the channel itself (`channelId` 1:1, INV-001). The entity column is retained as an unused legacy nullable (no migration); the channel-isolation e2e fixture comparison (`:740`) now compares the seeded fixture value against a column the write path no longer sets.

**Why it mattered (past tense).** `docs/adr/platform-adr.md:288-289` (pre-fix) stated the intended downward dependency ("`BigBlueButtonPlugin` may import from `TenantPlugin` … to verify `tenantProfileId` on org create") and mandated a string-ID cross-plugin reference instead of a TypeORM relation; `docs/architecture/domain-model.md:18,72` describes TenantProfile as 1:1 with BbbOrganization via `tenantProfileId`. With the field unreachable from the Admin API, that linkage held only for organizations created by the internal provisioning listener — never for an organization an operator created in the dashboard. Post-fix the ADR states the channel itself is the tenant link, and the 1:1 wording in `domain-model.md` is the remaining reference to reconcile.

**Fix — minimal option chosen (the additive option below was NOT taken).** ~~one direction must be chosen (no migration in either case: the column and its nullability are unchanged).~~
1. *(NOT taken — additive)* ~~Add `tenantProfileId: String` to the SDL input, keep the required-`string` types at the resolver and service, and **validate** that the value resolves to a `TenantProfile` in the caller's channel (the verification step `platform-adr.md:288` already anticipates), then assert the create/read round-trip in `bbb-channel-isolation.e2e-spec.ts`.~~
2. *(APPLIED 2026-10-01 — minimal)* ~~Remove the "Tenant Profile ID" field from the create dialog and make the service input `tenantProfileId?: string`, so the API stops implying a contract it cannot honour.~~ Fully removed the surface instead of merely optionaling it: resolver arg type, service input type, listener `create()` call, and dialog field/state/argument.

---

**BUG-054 — two pure-unit suites are named `*.e2e-spec.ts` "to match the vitest include pattern", but that pattern already accepts `*.spec.ts` and the service under test reads `process.env` directly instead of through Vendure's `ConfigService`, so the e2e gate counts unit assertions that can never catch DI/config wiring — **OPEN** (found 2026-10-01 while confirming the S7A follow-up list).**

> **Status:** OPEN — documented, not fixed. Low-to-medium: no product behaviour is wrong, but the `test:e2e` pass count is release evidence and is inflated by assertions that cannot fail for wiring reasons.

**Severity:** Low–Medium (mis-states what the "full e2e suite" proves; the suites are named as e2e, counted in the e2e gate, and structurally unable to detect a `ConfigService`/DI regression) · **Components:** `vitest.config.mts` (`test.include`), `src/plugins/marketplace/e2e/sponsored-boost-config.e2e-spec.ts`, `src/plugins/marketplace/e2e/baseline-service.e2e-spec.ts`, `src/plugins/marketplace/services/sponsored-boost-config.service.ts`

**The mismatch.** `vitest.config.mts` sets `include: ['src/**/*.e2e-spec.ts', 'src/**/*.spec.ts']`. Both files (and `baseline-refresh-task.e2e-spec.ts`) opened with the note "Named \*.e2e-spec.ts to match the vitest include pattern; see SponsoredBoostConfigService" — a constraint that does not exist for `.spec.ts`, so the naming rationale was stale. **Comment corrected 2026-10-01 (the bug itself stays OPEN):** the headers now state the suites run inside `test:e2e` only because they share the e2e vitest project and boot no server/ES/DB — the naming itself was not changed. Both are explicitly "No server boot, no ES, no DB": they construct the service with `new …()` and, for the config service, mutate `process.env` through a local `withEnv()` helper (`sponsored-boost-config.e2e-spec.ts`, 6 assertions) or mock `SettingsStoreService`/`TransactionalConnection` (`baseline-service.e2e-spec.ts`). They contribute **unit** assertions to the `test:e2e` count.

**Why it matters.** `SponsoredBoostConfigService` is an `@Injectable()` with a **no-argument** constructor that reads `process.env.SPONSORED_BOOST_MIN` / `SPONSORED_BOOST_MAX` itself, rather than reading configuration through Vendure's `ConfigService`/`Injector` the way the sibling `MARKETPLACE_COMMISSION_PERCENT` handling does (`docs/implementation/roadmap.md:158` records the intended "same pattern"). Consequences: (a) `new SponsoredBoostConfigService()` in the spec is the only way to exercise it, so refactoring to constructor-injected `ConfigService` (the platform convention) would break every assertion with `TS2554 Expected 1 arguments, but got 0` rather than a meaningful failure; (b) neither suite observes the NestJS provider graph, so a mis-registered provider or the wrong config source leaves all of them green; (c) because they are named `*.e2e-spec.ts` they run inside `npm run test:e2e` and are indistinguishable in the summary from infra-backed suites.

**Fix plan.** (1) Rename both to `*.spec.ts` — the include pattern already accepts them — so the e2e count means "runs against real infrastructure"; (2) optionally migrate `SponsoredBoostConfigService` to inject `ConfigService`/`Injector` with a stub in the spec (the fail-closed boot-abort contract is unchanged: non-numeric, `MIN < 1`, inverted window); (3) audit for the same anti-pattern before Phase 6.

> **Status:** FIXED 2026-10-05 (this commit). All three pure-unit suites
> (`sponsored-boost-config`, `baseline-service`, `baseline-refresh-task`)
> moved `e2e/` → `__tests__/` with untouched assertions (6 + 13 + 5 = 24,
> all green in the new location). No caller referenced the old paths
> (verified by repo-wide grep). Headers now record the relocation.
> The optional `ConfigService` injection (step 2) remains open as tech
> debt — it changes the service's construction contract, so it stays out
> of this rename.

**Marketplace stale-token flake (logged 2026-10-05, no code change).**
`marketplace.e2e-spec.ts:319-333` pre-cleans `e2e_marketplace_*` indices in
`beforeAll` because the e2e Postgres schema is recreated per run (session
PKs restart at 1) while ES indices were only cleaned best-effort in
`afterAll`. Without the pre-clean, a stale session doc from a previous run
with a recycled PK satisfies `waitFor()` immediately and carries that run's
`channelToken` — an order/state-dependent false failure, not a product bug.
The guard is in place and documented in the spec; this entry exists so the
flake is not re-investigated.

---

**BUG-055 — `dashboard-query-state.spec.ts`'s two shrink-only ratchets were RED on HEAD: the S5 dashboard-IA commit `06b20c8` added `PeopleList.tsx` (unguarded `items ?? []`, INV-015) and `LiveMeetingsList.tsx` (unrecorded `bbbOrganizations` picker, DL-031) and stripped `MeetingsList.tsx`'s picker, without updating either baseline — **NOT** an S7A regression; **FIXED 2026-10-01 (no spec weakening)**.**

> **Status:** FIXED 2026-10-01. `PeopleList`'s three reads routed through `resolveListState` (INV-015, with error branches); `LiveMeetingsList`'s cross-tenant picker recorded as platform tier (DL-031 — it is the platform "Live meetings" screen); `MeetingsList` removed from `LEGACY_ORG_PICKER_SCREENS` (its picker is gone — the shrink the ratchet wants). No baseline was grown.

**Severity:** Medium (a structural invariant guard — INV-015 "no list screen may hide a failure as an empty state" and DL-031 "tenant screens read the organization from the channel" — is red on HEAD, so that drift is currently **unenforced**; it also contributes 3 of the 6 failing assertions in the full e2e sweep) · **Components:** `src/plugins/subscription/__tests__/dashboard-query-state.spec.ts` (§C `LEGACY_UNGUARDED_EMPTY_STATE` :374,§413; §D `PLATFORM_TIER_PICKER_SCREENS` :492, `LEGACY_ORG_PICKER_SCREENS` :507,§560,§573), `src/plugins/bigbluebutton-plugin/dashboard/routes/people/PeopleList.tsx:95,137,144`, `src/plugins/bigbluebutton-plugin/dashboard/routes/meetings/LiveMeetingsList.tsx:39,81,109`, `src/plugins/bigbluebutton-plugin/dashboard/routes/meetings/MeetingsList.tsx`

**The three failing assertions (#C and #D of the ratchet).**

1. §C *adds no new unguarded empty state* → received `[PeopleList.tsx]`: the file reads `bbbOrganizationMembers?.items ?? []` (:95), `bbbRooms?.items ?? []` (:137) and `bbbEnrollmentsByRoom?.items ?? []` (:144) with **no `isError` branch and no `resolveListState`/`LedgerStateView`**, so a failed query renders as "no rows" (the exact INV-015 false signal the ratchet exists to prevent).
2. §D *allows an organization picker only on platform-tier screens and tracked deviations* → received `[LiveMeetingsList.tsx]`: it declares its own `bbbOrganizations` query and picker (:39, :109) but is in neither the platform-tier allowlist nor `LEGACY_ORG_PICKER_SCREENS`.
3. §D *keeps the org-picker baseline shrink-only* → received `[MeetingsList.tsx]`: the file **no longer references `bbbOrganizations` at all**, so its `LEGACY_ORG_PICKER_SCREENS` entry is stale and blocks the ratchet from shrinking.

**Evidence that this is pre-existing (S5), not S7A.** `06b20c8` ("feat(bbb): S5 dashboard IA — tenant Rooms/Meetings/People/Billing, platform Organizations/Servers/Capacity/Live Meetings/Trials") changed the screens (`PeopleList.tsx` +195, `LiveMeetingsList.tsx` +345, `MeetingsList.tsx` −346) while leaving `dashboard-query-state.spec.ts` **untouched** (`git diff --stat 06b20c8^ 06b20c8 -- …/dashboard-query-state.spec.ts` → empty). Run from clean `git worktree`s of that single spec: at `06b20c8^` **`30 passed (30)`**; at `06b20c8` **`3 failed | 27 passed (30)`** — the same three assertion names seen on HEAD. S7A touched only `bigbluebutton-plugin` **services**, so it cannot have caused a static source-scan over `dashboard/**`. The failure set therefore predates S6 (`f01c8c3`), S7A (`abab407`) and the BUG-052 fix (`872170f`) alike.

**Fix — applied 2026-10-01 (no spec weakening).** (1) `PeopleList`'s three reads routed through `resolveListState` with loading/error/blocked/empty branches — product code, not a baseline edit. (2) `LiveMeetingsList` classified platform tier and recorded in `PLATFORM_TIER_PICKER_SCREENS` (DL-031: its job is showing what runs across every tenant at once). (3) `MeetingsList` removed from `LEGACY_ORG_PICKER_SCREENS` — its picker is gone, the shrink the ratchet wants.

---

**BUG-052 — `r4-runtime-lifecycle.e2e-spec.ts` R4-04/08/09/10 assert legacy grant linkage against an organization that `createBbbOrganization` now makes `metered`, so the four tests assert a grant binding the organization can never have — **NOT a regression** (pre-S7A baseline reproduces it exactly); FIXED 2026-10-01 by pinning the fixture org to `grant` (found 2026-10-01 during S7A dependency-boundary verification).**

> **Status:** FIXED 2026-10-01 (S7A verification). `createOrganization()` in the R4 spec now calls the platform-gated `setBbbOrganizationBilling(billingMode: "grant")` immediately after `createBbbOrganization` and asserts the returned mode, so the grant path R4 exists to prove is the path that actually runs. Related harness defect fixed in the same pass: the S6 browser harness's fixture org (seeded by direct INSERT, so it keeps the DDL default) was left on the legacy `grant` mode with no grant, which made every Start class fail at the grant gate and the harness recorded that refusal as a *passing* "tenant-safe outcome" — it now pins the org to `metered` (the production default for new orgs), requires the click to reach `live`/`starting`, and cleans up the meetings it creates. `tenantSafeFailureMessage` also did not map the legacy no-grant/grant-exhausted reasons (they fell through to the generic "try again", which is non-actionable for a grant org) — now mapped to the paused-account sentence.

**Severity:** Medium (it was a **false-negative test surface, not a product defect** — the four assertions had been failing since the ADR-047 / D7 metered default landed, so R4's grant evidence was not actually being asserted and the failure was misread as an S7A regression) · **Components:** `src/plugins/bigbluebutton-plugin/e2e/r4-runtime-lifecycle.e2e-spec.ts` (`createOrganization()`, R4-04/08/09/10), `src/plugins/bigbluebutton-plugin/services/bbb-organization.service.ts` (`create()`, line 255), `scripts/e2e/bbb-dashboard-browser.ts`, `services/bbb-meeting.service.ts` (`tenantSafeFailureMessage`)

**What the code did.** ADR-047 / D7 made `BbbOrganizationService.create()` write `billingMode: BILLING_MODE.METERED` for every **new** organization (`bbb-organization.service.ts:255`), and kept `'grant'` as the untouched DDL default so existing rows are never backfilled. `create()` is the single place that does this, and the R4 spec creates its fixture org through it — so the org has **no** `BbbCapacityGrant(sourceType: 'order')` selected at provisioning, `meeting.grantId` stays `null`, and no `BbbUsageLedger` row is written (a metered org's billing truth is `BbbMeteredUsage`, not the grant ledger). R4-04 (`expected 'null' to be '2'`), R4-08 (`expected 0 to be greater than 0`), R4-09 (replays `reloadGrant(orderGrantId).consumedMinutes > 0`) and R4-10 (`ledgerRowsFor(meetingId)[0].grant` — undefined) all encode the legacy grant contract, so all four failed against a metered fixture org.

**Evidence that this is pre-existing, not an S7A regression.** Run from a clean `git worktree` at the **S6** commit `f01c8c3` — the commit *before* any S7A refactor — the R4 spec produced **`4 failed | 6 passed (10)`**, failing exactly `R4-04: provisioning selects the "order" grant (not overhead); meeting ACTIVE + session LIVE`, `R4-08: completion writes exactly ONE immutable usage-ledger fact bound to the "order" grant`, `R4-09: replaying the same (meetingId, grantId) never double-bills`, and `R4-10: a tenant-B customer cannot reach tenant A's meeting or entitlement`. The post-S7A run on `abab407` fails the **same four**, same assertions, same messages. The earlier "pre-existing" comparison had been run *after* commits 2–3 of the S7A series, which is what made the attribution look ambiguous; the worktree run removes that ambiguity.

**Why it went unnoticed.** R4's own suite is gated `R4_E2E=true` and is not in the default `npm run test:e2e` sweep, so the four failures sat in a suite nobody ran in CI, and the S7A characterization tests (`test:e2e:bbb-lifecycle`, 5/5) cover the lifecycle boundary rather than R4's grant linkage. **Cross-check (all green, same machine, 2026-10-01):** usage-ledger 5/5, channel-isolation 52/52, metering 10/10.

**Related but distinct (not a bug — documented design; STATUS UPDATED 2026-10-06).** TypeScript used to report `TS6307` in the IDE against `tsconfig.dashboard.json` for `src/plugins/bigbluebutton-plugin/shared/format.ts`, because that file sits outside the `dashboard/**` include of the dashboard project. This is **deliberate and load-bearing**: `shared/format.ts` is also imported by a root-project unit spec (`__tests__/format-paise-inr.spec.ts`), so it must stay in the root program; adding it to `tsconfig.dashboard.json`'s `include` makes the root `tsc` fail with `TS6305` (a file cannot be a root file of both a project and the composite project that references it) — verified by trying it. **Resolution (2026-10-06, `850738e`, BBB audit follow-up 4/5):** the four BBB dashboard screens now import a dashboard-local copy (`dashboard/lib/format.ts`), so no dashboard file imports `shared/format.ts` anymore and the TS6307 is gone from both the IDE and `tsc -p tsconfig.dashboard.json` (ratchet 119 → 118, `DashboardOverview.tsx` baseline entry removed). The two implementations are kept byte-identical by `__tests__/format-paise-inr-parity.spec.ts`, which dynamic-imports the dashboard copy (the only channel across the project boundary — tsc does not resolve a runtime-built specifier) and diffs its output over the full vector table. The TS6305 constraint itself is unchanged and is why the parity spec uses a dynamic import.

**BUG-051 — `BbbRoom.organizationId` is declared non-null in the SDL but no entity property or resolver populates it, so selecting it is a hard error — ✅ FIXED for `BbbRoom` 2026-09-30 (found 2026-09-30 while writing the S3 default-rooms e2e; sibling types flagged below).**

> **Status:** FIXED for `BbbRoom` 2026-09-30 (S3). The FK is now exposed with TypeORM's `@RelationId` (`entities/bbb-room.entity.ts`) — a read-only projection that selects the **existing** FK column without declaring a second column, so there is **no schema change and no migration**, while the SDL's `BbbRoom.organizationId` is hydrated on every `find*`. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §2 asserts the seeded default room's `organizationId` equals the organization's GraphQL id (pre-fix this answered `Cannot return null for non-nullable field BbbRoom.organizationId`). **Same pattern still open elsewhere** — at least `BbbOrganizationMember` (relation only, SDL declares `organizationId: ID!`); audit every non-null FK scalar before Phase 6 (dashboard) selects one. Not the same defect: `BbbEnrollment.roomId` *is* an entity property, but its entity TS type (string) and its DB column type (integer) drift — that is the pre-existing baseline failure recorded at `roadmap.md:41` and stays tracked there. **UPDATE 2026-10-05:** the fixture-level failure is fixed — `d2e3035` (2026-10-03) replaced the string sentinel with a DB-allocated PK, the customer-deletion suite is green in the full battery, and the documented baseline is now only the BUG-043 pair (roadmap.md:41 carries the dated note).

**Severity:** Medium (shipped contract lie — a documented non-null field that can never be read; no tenant data exposure) · **Components:** `api/schema/bbb-admin.schema.ts` (`type BbbRoom`, line 111), `entities/bbb-room.entity.ts`, `services/bbb-room.service.ts` (`findAll`)

**What the code did.** `BbbRoom` declares only `@ManyToOne(() => BbbOrganization, { nullable: false }) organization` — no scalar FK property, and `BbbRoomService.findAll()` did not load a relation that a field resolver could read — while the SDL exposes `organizationId: ID!`. `bbbRooms`/`bbbRoom` therefore returned `Cannot return null for non-nullable field BbbRoom.organizationId` (reproduced 2026-09-30 in the e2e, both on the list and on the tenant-side read) for **every** caller selecting that field. No pre-existing test selected it, which is why it survived.

**BUG-050 — `createBbbOrganization` accepted an arbitrary `channelId`, so a tenant admin could provision an organization row on another tenant's channel — ✅ FIXED 2026-09-30 (found 2026-09-30 by read-before-edit audit during S1; INV-001 / SEC-008).**

> **Status:** FIXED 2026-09-30. `BbbOrganizationService.create()` now rejects a non-platform caller whose normalized `input.channelId` differs from `ctx.channelId` with `ForbiddenError`; platform callers (SuperAdmin / `BBBAdmin` / `BBBPlatformInfrastructure` via the shared `isPlatformCaller()`) keep any-channel creation. This also guarantees the scalar `channelId` and the `channels` many-to-many assignment (`assignToCurrentChannel(org, ctx)`) can never diverge. Listener/system provisioning (`BbbTenantProvisioningListener`) creates with a channel-scoped, user-less ctx, so it stays on its own channel and is unaffected. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §10; source guard: `channel-scoped-reads-remediated` in `MeteredBillingChecker`.

**Severity:** High (cross-tenant write — an org row on a foreign channel, with the caller's own channel attached to the `channels` join) · **Components:** `services/bbb-organization.service.ts` (`create()`), `api/bbb-admin.resolver.ts` (`createBbbOrganization`)

**What the code did.** `create()` normalized and stored `input.channelId` and called `assignToCurrentChannel(org, ctx)` without ever comparing the two, while `createBbbOrganization` is gated `@Allow(BbbAdmin, BbbManageOrganizations)` — the latter held by every tenant admin role.

**BUG-046 — `bbbMeetings` with `organizationId` omitted applied no channel filter, so any tenant admin could read every tenant's meetings — ✅ FIXED 2026-09-30 (found 2026-09-30 by code audit; A16 / INV-029 / SEC-008).**

> **Status:** FIXED 2026-09-30 (S1). `meetingService.findAll()` now derives the no-argument organization set from `ctx.channelId` (org→channels join) for non-platform callers, channel-asserts explicit `organizationId`/`roomId` arguments through `BbbChannelAccessService`, and keeps the unrestricted listing behind the shared `isPlatformCaller()` helper. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §8; source guard: `channel-scoped-reads-remediated` in `MeteredBillingChecker`. The shipped screen (`MeetingsList.tsx`) reads its own tenant's rows even before Phase 6 removes its org picker.

**Severity:** High (cross-tenant read through a shipped tenant screen) · **Components:** `src/plugins/bigbluebutton-plugin/services/bbb-meeting.service.ts:137-160`, `api/bbb-admin.resolver.ts:491-497`, `dashboard/routes/meetings/MeetingsList.tsx:91-103`

**What the code does.** The tenant-visible `bbbMeetings` query takes an optional `organizationId`. The service only adds an organization predicate when the argument is present, so omitting it returns **all** meetings with no channel constraint; the resolver passes the optional value straight through, and the shipped `MeetingsList.tsx` calls it with no argument while also rendering an `bbbOrganizations` picker (a platform-tier query). Tenant admins hold `BbbManageMeetings`, so any tenant admin can read another tenant's meeting rows — room names, start/end times, states, participant counts, ids.

**Fix plan (Phase 5).** (1) Non-platform callers get the organization derived from `ctx.channelId` (`BbbChannelAccessService`) and the argument is ignored/removed; (2) the cross-tenant (no-org) path becomes platform-only behind `@Allow(BbbAdmin, BBBPlatformInfrastructure)`; (3) verify the `bbbOrganizations` resolver guard; (4) add cross-tenant regression cases to `bbb-channel-isolation.e2e-spec.ts`.

**BUG-047 — Tenant admins could un-suspend their own organization, mint free capacity grants, and delete their own organization — ✅ FIXED 2026-09-30 (H1 + H2 both landed) (found 2026-09-30 by code audit; A17 / SEC-008 / H1+H2).**

> **Status:** **H2 FIXED 2026-09-30** (go-ahead given in the plan's §7 register): `createBbbCapacityGrant` and `deleteBbbOrganization` are retargeted to `BBBPlatformInfrastructure`; the tenant role is untouched (A15) and the shipped `Capacity Grants` nav gate mirrors the backend gate. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §6 (tenant denied on its **own** org, no grant row written, no partial delete, platform operator still allowed); source guard: `sec-008-platform-guards` in `MeteredBillingChecker`. Seed script step 10 now authenticates as platform operator. **H1 FIXED 2026-09-30 (S1):** `orgService.update()` now applies the `TENANT_EDITABLE_ORG_FIELDS` allowlist (`name`, `recordingEnabled`) — `suspended`, `maxSessionsPerOrg`, `concurrentMeetingLimit` and `maxParticipantsPerMeeting` are rejected with `ForbiddenError` for non-platform callers; billing fields (`billingMode`, `ratePaisePerLearnerHour`, `monthlySpendLimitPaise`) stay outside `UpdateBbbOrganizationInput` entirely and arrive with `setBbbOrganizationBilling` in Phase 4. Platform callers keep the full input (the INV-015 capacity re-sync still applies to them). Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §9; source guard: `channel-scoped-reads-remediated` in `MeteredBillingChecker`.

**Severity:** High (privilege escalation; with ADR-047 landed, `suspended` is the postpaid credit guard) · **Components:** `api/bbb-admin.resolver.ts:280-289` (`updateBbbOrganization`), `:552-561` (`deleteBbbOrganization`), `:599-631` (`createBbbCapacityGrant`); `services/bbb-organization.service.ts:277`; input types `api/schema/bbb-admin.schema.ts:90-98`

**What the code does.** `updateBbbOrganization` is gated `@Allow(BbbAdmin.Permission, BbbManageOrganizations.Permission)` — both held by the tenant admin role — and `Object.assign(org, input)` includes `suspended`, so a tenant clears its own suspension. The same role reaches `createBbbCapacityGrant` (free capacity) and `deleteBbbOrganization` (destructive).

**Fix plan.** H1 (Phase 4): `billingMode`, `ratePaisePerLearnerHour`, `monthlySpendLimitPaise`, `suspended` are settable **only** via the new `BBBPlatformInfrastructure`-gated `setBbbOrganizationBilling`, never via `UpdateBbbOrganizationInput` (grep seed scripts — `scripts/seed/seed-via-graphql.sh` calls `updateBbbOrganization`). H2: retarget the other two mutations to `BBBPlatformInfrastructure`.

**BUG-048 — `MeetingCompletedEvent.organizationId` was published as `undefined` from the completion path — ✅ FIXED 2026-09-30 (verified at `04247fc`; regression assertion added with S1) (found 2026-09-30 by code audit; A13).**

> **Status:** FIXED. `completeMeetingLifecycle` loads the meeting with `leftJoinAndSelect("meeting.organization")` under a meeting-scoped pessimistic lock, and the publish site passes `meeting.organization?.id` — both verified at `04247fc`. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §8 ("A13 regression: `MeetingCompletedEvent` carries the organization id").

**Severity:** Medium (silent downstream no-op — an org-scoped consumer sees `undefined` and does nothing) · **Components:** `src/plugins/bigbluebutton-plugin/services/bbb-meeting.service.ts:266-269`, `:349-358`

**What the code does.** `completeMeetingLifecycle` loads the meeting with `manager.findOne` **without relations**, then publishes `MeetingCompletedEvent` with `meeting.organization?.id` — which is `undefined` on that path. The grant billing path is unaffected (it bills through the persisted `grantId`), but any consumer that scopes work by organization silently skips. Metered billing must therefore load the organization itself, and the `undefined` id should be fixed at the source (load the relation / pass the resolved id).

**BUG-049 — `bbbCapacityGrants` accepts an arbitrary `organizationId` with no channel assert — ✅ FIXED 2026-09-30 (found 2026-09-30 by code audit; A18 / H3 / SEC-008).**

> **Status:** FIXED 2026-09-30 once the §7 scope decision was answered (fix in this work, not separately). The query now calls `assertOrganizationAccess(ctx, orgId)` **before** reading, so a tenant admin can only read grants for an organization in its own channel (`ctx.channelId`) and cross-tenant reads raise `ForbiddenError`; own-channel reads stay legitimate (the shipped `PlansList` derives the organization from the active channel — INV-029), and SuperAdmin short-circuits inside the assert. Regression e2e: `bbb-channel-isolation.e2e-spec.ts` §7 (tenant B reads its own grants, tenant B reading tenant A's grants rejects); source guard: `sec-008-platform-guards` in `MeteredBillingChecker`.

**Severity:** Medium-High (cross-tenant read of grant quantities/validity; no write) · **Components:** `api/bbb-admin.resolver.ts:579-594`

**What the code does.** The query takes `organizationId` and returns that organization's capacity grants without any channel assertion, so a tenant admin (who holds `BbbManageOrganizations`) can enumerate another tenant's grant rows. Natural fix is the INV-029 pattern: derive the organization from `ctx.channelId` for tenant-tier callers and gate the explicit-arg path behind `BBBPlatformInfrastructure`.

**BUG-044 — `createBbbCapacityGrant` never sets `sourceType`, so every admin-manual capacity grant is silently stored as `sourceType = 'order'` — ✅ FIXED 2026-09-30 (code + docs; data backfill is runbook-pending) (found 2026-09-30 by code audit).**

> **Status:** fixed 2026-09-30. Code: `sourceType: 'manual'` in the mutation, `'manual'` added to `GrantSourceType` **and** `TENANT_SELECTABLE_SOURCE_TYPES` (the coupling that preserves provisioning/`myLiveUsage` behavior), `sourceType` exposed on the Admin GraphQL type (additive, INV-007) and read by the PlansList Source column. Verified: `npm run build` ✅, `grant-selection.policy.spec.ts` 8/8 ✅, `npm run verify:invariants` 5/5 static ✅ (incl. dashboard GraphQL contract — the new field validates). Schema: **no migration** — `psql \d bbb_capacity_grant` confirms `sourceType character varying NOT NULL DEFAULT 'order'`, no CHECK, no enum. **Remaining (data):** backfill of the 9 existing rows — see fix plan (5); preview verified 2026-09-30: all 9 candidates have NULL `orderId`/`orderLineId`/`productVariantId`, i.e. manual grants, no purchase rows in scope.

**Severity:** Medium (silent data corruption — manual overrides are indistinguishable from purchases for any `sourceType`-based aggregation; no product symptom today because the dashboard Source column infers from `orderId`) · **Discovered:** 2026-09-30, code audit while verifying an external assessment · **Components:** `src/plugins/bigbluebutton-plugin/api/bbb-admin.resolver.ts` (`createBbbCapacityGrant`, ~:619), `src/plugins/bigbluebutton-plugin/entities/bbb-capacity-grant.entity.ts:61-62`, `src/plugins/bigbluebutton-plugin/services/grant-selection.policy.ts:20,29-32`, `src/plugins/bigbluebutton-plugin/dashboard/routes/plans/PlansList.tsx:226-232`

**What the code does.** `BbbCapacityGrant.sourceType` is a column with exactly three legal values (`"order" | "subscription" | "internal_overhead"`) and `default: "order"`. The Admin mutation `createBbbCapacityGrant` constructs the grant without ever passing `sourceType`, so every manual override persists as `'order'`. The five write sites: fulfillment handler (correct by default), subscription listener (`'subscription'`), org provisioning (`'internal_overhead'`), daily allowance (`'subscription'`), and this resolver (**wrong**).

**Why it matters.** (1) Revenue/attribution reporting that groups by `sourceType` counts manual grants as purchases. (2) The dashboard Source column cannot read the field — it infers "Admin Override" from `orderId == null`, which also mislabels every `internal_overhead` grant as "Admin Override" (they have no `orderId` either). (3) Any future consumer of `sourceType` inherits the corruption.

**Fix plan.** (1) Widen the union with `'manual'`; (2) add `'manual'` to `GrantSourceType` **and** `TENANT_SELECTABLE_SOURCE_TYPES` — **mandatory coupling**: without it, orgs whose only grant is manual stop provisioning (`PROVISIONING_NO_GRANT_ERROR`) and `myLiveUsage` stops counting their allowance — they pass the filter today only because they masquerade as `'order'`, so behavior is preserved only if `'manual'` stays selectable; (3) set `sourceType: 'manual'` in `createBbbCapacityGrant`; (4) expose `sourceType` on the Admin `BbbCapacityGrant` type (additive, INV-007) and read it in `PlansList`; (5) backfill `UPDATE bbb_capacity_grant SET "sourceType" = 'manual' WHERE "orderId" IS NULL AND "sourceType" = 'order'` (column names are camelCase and must be quoted in SQL; safe predicate: the fulfillment handler always sets `orderId`; subscription/daily/overhead writers set their own discriminator). **No schema change — confirmed 2026-09-30 via `psql \d bbb_capacity_grant`: `sourceType` is `character varying NOT NULL DEFAULT 'order'` with no CHECK constraint and no enum, so rule #7 (Vendure-CLI migrations) is not triggered; the backfill is data-only and runs as documented runbook SQL.**

---

**BUG-045 — Room preview (`bbbRoomStatus`) and room join (`joinRoom`) evaluate divergent authorization sets, and join authorization runs only after provisioning is triggered — ✅ FIXED 2026-09-30 (INV-027) (found 2026-09-30 by code audit).**

> **Status:** fixed 2026-09-30. Fix: single shared evaluation — pure `services/room-access.policy.ts` + `services/room-access.service.ts` (`BbbRoomAccessService.evaluate`) over the four sources, consumed by **both** `bbbRoomStatus` and `joinRoom`, with join's evaluation hoisted **above** `requestProvisioning`; dead `provisionAndJoin` seam removed; stale `assertActiveMembership` comment corrected. Verified: `npm run build` ✅, `npm run typecheck:e2e` ✅, `room-access.policy.spec.ts` 13/13 ✅, `npm run verify:invariants` → `RoomAccessChecker` ✅ ("INV-027 verified: preview and join share one room-access evaluation, authorized before provisioning") with ordering enforced structurally (`this.roomAccessService.evaluate` must precede `this.roomService.requestProvisioning` in `joinRoom`). Documented: INV-027 in `docs/architecture/invariants.md` (before implementation, rule #9); `platform-story.md`, `runtime-flow.md`, `domain-model.md` gate docs updated. **Residual (same family, out of INV-027 scope):** `myBbbRooms` staff listing still derives rooms from the legacy `BbbMemberService` only, so FEAT-001 membership staff do not see org rooms in that listing (decision-surface parity is fixed; the listing read is not).

**Severity:** High (customer-visible access contradictions in both directions + any authenticated channel customer can trigger BBB provisioning for any room in their tenant) · **Discovered:** 2026-09-30, code audit while verifying an external assessment · **Components:** `src/plugins/bigbluebutton-plugin/services/bbb-meeting.service.ts` (`joinRoom`, :807-968), `src/plugins/bigbluebutton-plugin/api/bbb-shop.resolver.ts` (`bbbRoomStatus`, :177-215; stale comment :234-235), `src/plugins/bigbluebutton-plugin/services/bbb-entitlement.service.ts` (`hasAccess`, :107)

**Three defects, one family — two hand-rolled authorization lists that drifted apart:**

1. **Display ✓ / join ✗ (enrollment).** `bbbRoomStatus` accepts a valid `BbbEnrollment` (:189-212), but `joinRoom` Gate 3 only calls `entitlementService.hasAccess(..., 'bbb_room', ...)`, which reads `BbbEntitlement` exclusively. An admin-created enrollment (`EnrollmentsList` → `createBbbEnrollment`, the only remaining `BbbEnrollment` writer, plus legacy rows) lets the customer see the room as accessible, then join throws "You do not have access to this room."
2. **Display ✗ / join ✓ (membership).** `bbbRoomStatus` never checks `BbbOrganizationMembership` — the resolver does not even inject `BbbMembershipService` — so FEAT-001 staff who pass `joinRoom` Gate 1 receive `ForbiddenError` from the preview query.
3. **Authorization after provisioning.** `joinRoom` invokes `requestProvisioning` (and, on an idle room, `createRoomMeetingAndEnqueue`) **before** any gate; gates run only in the `status === 'active'` branch. `_doRequestProvisioning` channel-scopes only (`assertRoomAccess`). The join URL remains gated, so this is not an access bypass — but any authenticated shop customer can spin up BBB provisioning for any room in their channel. The resolver comment at :234-235 claiming `memberService.assertActiveMembership` enforces this is false (that method has no call site in the join path).

**Fix plan (INV-027).** Extract a single room-access evaluation — pure policy module `services/room-access.policy.ts` (expiry semantics + role derivation) + one shared service evaluator returning `{ allowed, isModerator, source }` over the four sources (active `BbbOrganizationMembership` ∨ active `BbbOrganizationMember` ∨ valid `BbbEntitlement` ∨ valid `BbbEnrollment`) — and use it from **both** `joinRoom` (hoisted **above** `requestProvisioning`) and `bbbRoomStatus`. Structural checker registered under `npm run verify:invariants`.

---

**BUG-043 — `subscription-shop.e2e-spec.ts` still asserts the pre-ADR-045 `myLiveUsage` allowance, so two of its assertions cannot pass (found 2026-09-27 by A/B against unchanged code; **OPEN** — decision required, see below).** Not a BUG-040 regression: both failures reproduce identically with the BUG-040 work stashed.

**BUG-040, BUG-041, and BUG-042 are fixed and runtime-verified (2026-09-27).** BUG-036 (provisioning capacity/`isUnbounded`) was fixed and runtime-reproduced on 2026-09-23 in `d711940`; BUG-037 (the `bbb-channel-isolation` e2e harness could not pass) was found and fixed on 2026-09-24; BUG-038 (`bbbFulfillmentHandler` read the never-loaded `order.lines`, so no `order`-source capacity grant could ever be written) was found and fixed on 2026-09-25 while producing the Slice 10 / R4 runtime-lifecycle evidence; BUG-039 (Tier 2 of the capacity-policy cascade ran schema-blind raw SQL, so plan-derived concurrency silently resolved to `fallback` whenever `dbConnectionOptions.schema` was set) was found and fixed on 2026-09-25. All six archived entries are below; the fixes are recorded in `release-notes.md`.

## BUG-040 — Subscription lookups by channel are unordered and unfiltered, so cancel/change can target a stale cancelled row — ✅ FIXED and runtime-verified 2026-09-27 (found live 2026-09-27)

> **Status:** fixed and runtime-verified 2026-09-27 against a live dev server, after PR #3
> (`b3a3704`) turned out to be an **incomplete** fix whose regression test could not pass.
> The pre-fix record below is retained in full — every symptom in it was reproduced live
> before the fix.
> **Completion commit:** `2b447d7` (see the fix block at the end of
> this section). **Still open:** its sibling defect **BUG-041** (the provider refuses to
> cancel a never-billed mandate), which now accounts for every remaining acceptance
> failure and is *not* part of this defect.

**Severity:** High (billing correctness + orphaned provider subscriptions) · **Discovered:** 2026-09-27, live, while executing `scripts/verify/adr-044-acceptance.sh` against a running dev server · **Components:** `src/plugins/subscription/services/subscription.service.ts` (channel lookups at lines 140, 389, 646; binding lookups at 431, 662, 769), `src/plugins/subscription/entities/organization-subscription.entity.ts:40`

**What the code does.** The row that means "this channel's subscription" is fetched as `repo.findOne({ where: { channelId }, relations: ['plan'] })` — no `status` predicate, no `ORDER BY`. The partial unique index `@Index(['channelId'], { unique: true, where: '"status" != \'cancelled\'' })` (DB name `IDX_b6741adfd949003e33d62dba5f`) deliberately allows any number of **cancelled** rows per channel while permitting one live row — i.e. the table is designed to hold a cancelled row *and* a live row for the same channel at the same time. `findOne` is then free to return either one.

**Failure modes — all three reproduced in a single live run (channel 31).**

1. **Cancel targets the stale row.** `cancelOrganizationSubscription` resolved row 16 (`cancelled`, plan `free-basic`) instead of row 17 (`pending_provider_auth`, plan `adr044-paid-a-…`). Three consecutive cancels (acceptance scenarios 6, 7, 8) therefore never touched the live subscription: post-run, row 17 was **still `pending_provider_auth`**.
2. **Change-plan reads the stale row.** `changeOrganizationSubscriptionPlan(→ paidB)` and `(→ free)` each failed with `Channel 31 subscription is cancelled; use subscribeToPlan to start a new subscription` — a misleading error, because a live subscription existed at that moment.
3. **Re-subscribe orphans a provider subscription.** With row 17 still live, `subscribeToPlan` created the provider subscription **first** (ADR-039 external-side-effect ordering) and only then failed to persist: `Subscription persisted-state failure after provider creation. ORPHAN provider subscription sub_TguvSWt6mE5YYe (channel 31) must be reconciled/cancelled in the provider dashboard. Cause: duplicate key value violates unique constraint "IDX_b6741adfd949003e33d62dba5f"`. No local row and no binding row reference it.

**Why this is reachable outside the harness.** Cancel-then-re-subscribe is a supported flow — the acceptance script asserts it as scenario 9 ("partial unique index slot freed"). Any channel that has ever cancelled a subscription keeps a leftover row and is exposed to (1)–(3) from then on.

**Evidence.**

```sql
-- post-run state of the acceptance run's tenant channel
select id, "channelId", status, "planId" from public.organization_subscription
 where "channelId" = '31' order by id;
 id | channelId |        status         | planId
 16 |        31 | cancelled             |      3   -- cancelled by the harness precondition step
 17 |        31 | pending_provider_auth |     10   -- created by scenario 3; never cancelled

select id, "channelId", provider, "providerSubscriptionId", active from public.subscription_provider_binding
 where "channelId" = '31';
  9 |        31 | razorpay | sub_TguvPCno19wMSu | f   -- only scenario 3's binding; scenario 9's never persisted
```

Acceptance run summary: `passed: 25  failed: 13  skipped: 2`. All 13 failures are downstream of this defect — scenario 4: 4, scenario 5: 1, scenario 6: 3, scenario 9: 3, scenario 10: 2. Scenario 9's expectation ("partial unique index slot freed") is correct as a design intent; it fails because the live row was never actually cancelled.

**Fix (applied 2026-09-27) — and why PR #3 alone did not close it.** PR #3 made the lookups status-aware in `subscription.service.ts` (the channel lookups and both binding lookups), but left a **live consumer untouched**: `CommercialEntitlementService.findChannelSubscription()` still ran `findOne({ where: { channelId }, relations: ['plan'] })` while its docstring claimed to *mirror* the fixed predicate. That path serves `mySubscription`, `myLiveUsage` and the ADR-042 marketplace gate, so a channel with a cancelled row beside a live one could still read history. The rule now lives in ONE place — `services/subscription-lookup.policy.ts` (`liveSubscriptionWhere()`, `findLiveSubscriptionForChannel()`, `findCurrentSubscriptionForChannel()`) — and every channel→subscription read calls it: `findSubscriptionByChannel`, the `subscribeToPlan` slot guard, `changeOrganizationSubscriptionPlan` (Admin and ADR-046 self-serve), `cancelOrganizationSubscription`, legacy `createProviderBinding`, `CommercialEntitlementService.findChannelSubscription`, and the three lookups in `FreePlanProvisioningService` (whose unordered pre-check could return the cancelled row and then attempt an insert the unique index rejects). No schema change. The BUG-036 lesson is why the predicate is a shared policy instead of five inline copies — the drift that left this instance behind is exactly what duplicated rules do.

**The regression test also had to be made runnable.** PR #3's `BUG-040` case had never been executed (the PR reports no workflow runs) and could not pass: it called the SuperAdmin-only `subscribeToPlan` / `cancelOrganizationSubscription` with a tenant-Administrator session (`You are not currently authorized to perform this action`), and it passed the **transient** registration id (`T_2`) into raw-SQL integer parameters (`invalid input syntax for type integer: "T_2"`). It now uses the SuperAdmin actor for the Admin mutations, the tenant business-account session for the Shop reads, and the repo's existing `decode()` helper (`r4-runtime-lifecycle.e2e-spec.ts`) for the persisted id — and additionally asserts the **read path** this completion closes (live row wins; a cancelled-only channel still reports `cancelled`, deterministically from the newest row).

**Runtime evidence (2026-09-27, live dev server rebuilt with this change set).**

| Evidence | Result |
|---|---|
| `adr-046-self-serve.e2e-spec.ts` (real Postgres) | **9/9 pass** — the BUG-040 case now runs: coexistence fixture, Shop plan change, `mySubscription` live-row read, cancel returns the live row id, terminal fallback |
| Live ADR-044 acceptance, channel **35** | `subscribeToPlan` → row 24 `pending_provider_auth`; harness pre-clear leaves row 23 `cancelled` (plan `free-basic`) — the exact coexistence state |
| Live row was selected, not the stale row | every cancel/change reached the **provider** and returned Razorpay's `400 … no billing cycle is going on`. A stale `free-basic` row would have taken the provider-free branch and returned local success with no provider call |
| **No orphan** | `grep -c ORPHAN` over the server log = **0**; binding 11 → `subscriptionId 24` (the live row), provider subscription `sub_Tgzkb7Xu5q5CZz` — one provider subscription, one binding, no unreferenced provider row (pre-fix this same path orphaned `sub_TguvSWt6mE5YYe`) |
| `subscribeToPlan` slot guard | re-subscribe refused **before** any provider call: `Channel 35 already has a non-cancelled subscription (status 'pending_provider_auth')` — validation-first, ADR-039 |
| Phase 8 fixture layer (§4 harness) | `typecheck:e2e` 0; `verify.ts` **16/16 PASS** after the fix (tenant-b's `cancelled` read now traverses the fixed entitlement lookup); reseed idempotent (ids 32/33, 13/14, 20/21, 23/24 unchanged) with **no resurrection** of the cancelled tenant |

The acceptance suite's remaining 16 failures are **BUG-041**, not this defect.

---

## BUG-041 — A provider-wired cancel/change of a never-authorized mandate is refused by the provider — ✅ FIXED and runtime-verified 2026-09-27 (found live 2026-09-27)

> **Status:** fixed and runtime-verified 2026-09-27 against a live dev server.
> Unit tests in `razorpay-error.mapper.spec.ts` (9/9). Acceptance suite
> `scripts/verify/adr-044-acceptance.sh` passes 35/35 active checks (scenarios 4-11
> all passing; 2 skipped as pre-existing).

**Severity:** High (blocks every provider-wired ADR-044 acceptance scenario; a tenant cannot abandon an unauthorized subscription) · **Discovered:** 2026-09-27, live, while re-running `scripts/verify/adr-044-acceptance.sh` after the BUG-040 completion · **Components:** `src/plugins/subscription/providers/razorpay/*` (the provider leg of cancel/change), `src/plugins/subscription/services/subscription.service.ts` (`cancelOrganizationSubscription`, `changeOrganizationSubscriptionPlanInternal`), `src/plugins/subscription/providers/recurring-billing.provider.ts`

**What the code does.** `subscribeToPlan` creates the Razorpay subscription and persists the mandate with `providerStatus = 'created'` and local status `pending_provider_auth`. A later cancel — or a plan change, which cancels the outgoing mandate provider-side before binding the new one — calls the provider's cancel API. Razorpay refuses while the subscription has never had a billing cycle.

**Evidence (raw GraphQL response, channel 35, 2026-09-27).**

```json
{"errors":[{"message":"Unexpected error value: { statusCode: 400, error: { code: "BAD_REQUEST_ERROR", description: "Subscription cannot be cancelled since no billing cycle is going on" } }","path":["cancelOrganizationSubscription"]}],"data":null}
```

All four `cancelOrganizationSubscription` calls and all three `changeOrganizationSubscriptionPlan` calls of the run failed this way. The local row correctly stayed `pending_provider_auth` (ADR-039 ordering: provider side-effect before local persist), so the run reports `22 passed / 16 failed / 2 skipped` with **all 16** assertions downstream of this one provider response. Note these are *different* failures from the `25 passed / 13 failed` run that exposed BUG-040: the code path is now correct, the provider refuses.

**Why this is not BUG-040.** The provider call is only reached *because* the live row was selected and its binding resolved — the property the BUG-040 fix was for. Under the pre-fix code the stale provider-free row was chosen, no provider call was made, and the mutation returned a false success.

**Fix (applied 2026-09-27).**
1. Provider-neutral typed errors in `recurring-billing.provider.ts`: `RecurringBillingProviderError` and `ProviderSubscriptionNoActiveCycleError` (`PROVIDER_SUBSCRIPTION_NO_ACTIVE_CYCLE`).
2. Error mapper in `razorpay-error.mapper.ts` that safely inspects raw SDK errors/objects, extracts status codes and error descriptions without leaking credentials, request/response bodies, or secrets, and classifies `BAD_REQUEST_ERROR` + `"Subscription cannot be cancelled since no billing cycle is going on"` as `ProviderSubscriptionNoActiveCycleError`.
3. SDK call encapsulation in `RazorpaySubscriptionProvider.call()` wrapping all provider operations (`createSubscription`, `getSubscription`, `cancelSubscription`, `pauseSubscription`, `resumeSubscription`), preventing raw plain objects from escaping to GraphQL. Also corrected `cancelSubscription` argument passing to match Razorpay Node SDK `(subscriptionId, cancelAtCycleEnd: boolean)`.
4. Domain layer in `SubscriptionService`: catches `ProviderSubscriptionNoActiveCycleError` in `changeOrganizationSubscriptionPlan` (supersede continues since previous mandate has no cycle to cancel) and `cancelOrganizationSubscription` (cancels locally immediately since there is no billing cycle to wait for). Other provider errors remain fatal per ADR-039.
5. Harness update: in `scripts/verify/adr-044-acceptance.sh` scenario 6, recognizing that `pending_provider_auth` with no active cycle cannot be scheduled at cycle end by Razorpay, so it completes immediate local cancellation.

**Runtime evidence (2026-09-27).**
- Unit tests: `src/plugins/subscription/providers/razorpay/__tests__/razorpay-error.mapper.spec.ts` 9/9 PASS.
- Live acceptance: `scripts/verify/adr-044-acceptance.sh` → `passed: 35   failed: 0   skipped: 2`. All scenarios 4–11 and 14 passing.

---

## BUG-042 — `cancelOrganizationSubscription` returned a subscription with no `plan` relation — ✅ FIXED 2026-09-27 (found 2026-09-27)

> **Status:** fixed and verified 2026-09-27 — `adr-046-self-serve.e2e-spec.ts` **9/9** (the case selects `plan { id slug }` on the cancel mutation), against real Postgres.

**Severity:** Medium (Admin API contract violation: any client selecting `plan` on this mutation received a GraphQL error) · **Components:** `src/plugins/subscription/services/subscription.service.ts` (`cancelOrganizationSubscription`)

**What the code did.** The cancellation transaction re-reads the row under `pessimistic_write` **without** the `plan` relation (Postgres cannot apply `FOR UPDATE` across the outer join TypeORM emits for a relation) and returned that entity. The Admin schema declares `plan: SubscriptionPlan!`, so a client selecting it got `Cannot return null for non-nullable field OrganizationSubscription.plan` — reproduced live by the BUG-040 regression test once it could actually run. The acceptance harness never selected `plan` on cancel, which is why this stayed invisible; the plan-change path was unaffected (it assigns `managed.plan = target` explicitly).

**Fix.** After the transaction commits, re-read the persisted row with `relations: ["plan"]` and return it (`persisted ?? saved`). No schema change.

---

## BUG-043 — `subscription-shop.e2e-spec.ts` still asserts the pre-ADR-045 `myLiveUsage` allowance — **OPEN** (found 2026-09-27)

**Severity:** Low (test drift: no product symptom observed) · **Components:** `src/plugins/subscription/__tests__/subscription-shop.e2e-spec.ts` (the two `myLiveUsage` cases)

**What happens.** Two assertions expect `includedMinutes: 0` (a channel whose only grant is `internal_overhead`) and `100` (a 100-minute `order` grant, 30 consumed) but receive `60` and `160` — a constant **+60** in both. The extra 60 minutes is a `sourceType = 'subscription'` grant, which `myLiveUsage` counts by design: `TENANT_SELECTABLE_SOURCE_TYPES = ['order', 'subscription']`, and ADR-045's daily allowance is itself recorded as `sourceType = 'subscription'` (the dedup key is `(organization, validFrom = startOfDay, sourceType)`). So either the daily allowance is meant to be part of "included minutes" (the test is stale) or it must be excluded from the read (the read is wrong).

**A/B (decisive — this is not a BUG-040 regression).** Both failures reproduce **identically with the BUG-040 completion work stashed**: `2 failed | 10 passed (12)`, same `60` / `160` received values, same `- 100 / + 160` diff.

**Decision required (not applied).** Confirm ADR-045's intent, then either update the two expectations (documenting the 60-minute daily allowance as included minutes) or narrow the read's source-type filter. Deliberately **not** aligned to observed behaviour: editing the test to match would mask a possible product defect, and rewriting the read without the ADR-045 decision would remove a real allowance from the tenant-facing surface.

**Baseline status (2026-10-05).** After `d2e3035` (2026-10-03) fixed the customer-deletion fixture pair, these two `myLiveUsage` assertions are the **only** failing tests in the full `npm run test:e2e` battery — the documented baseline is "everything green except the BUG-043 pair" (dated note at roadmap.md:41).

---

## BUG-036 — Provisioning capacity check ignored `isUnbounded` — ✅ FIXED (`d711940`, 2026-09-23)

> **Status:** fixed and runtime-verified 2026-09-23 (commit `d711940`). The sections
> below are retained as the pre-fix record — every symptom in them was
> reproduced at runtime before the fix and is now covered by tests.

**Severity:** High · **Discovered:** 2026-09-22 (static code reading); **runtime-reproduced:** 2026-09-23 · **Components:** `bbb-provisioning-worker.service.ts` (`doProvisionMeeting`), `bbb-organization.service.ts` (overhead grant), `grant-reader.service.ts`

**What the code does.** `BbbOrganizationService.create()` auto-provisions an unbounded overhead grant per organization (`isUnbounded: true`, `grantedMinutes: -1`, `validUntil: 2099-12-31`). `doProvisionMeeting()` selects a grant with `exhausted = false`, an in-window `validFrom`/`validUntil`, ordered `validUntil ASC, createdAt ASC` — then rejects the meeting when `(grant.grantedMinutes ?? 0) - (grant.consumedMinutes ?? 0) <= 0`. That check never consults `isUnbounded`; only `GrantReaderService.getRemainingMinutes()` treats unbounded grants as `Infinity`.

**Failure modes.**

1. **Severe:** an organization whose only valid grant is the overhead grant can never provision a meeting — selection picks the overhead grant, computes `-1 - consumed <= 0`, and throws `"No minutes remaining on plan"`.
2. **Misleading:** once a commercial grant reaches its limit it is flagged `exhausted = true`, which *excludes* it from selection; the resolver then lands on the overhead grant and throws the same message — so an exhausted allowance is reported as a missing one, and the real commercial state never reaches the caller.

**Why it matters now.** Tenants register without a purchased grant, and the planned Free Basic tier adds a per-day allowance on this table. Shipping the allowance without fixing selection would leave the free tier depending on a fall-through path that throws.

**Decision and fix (`d711940`).** Both fix options were taken, plus the accuracy gap between them:

- Config: new `services/grant-selection.policy.ts` is the single home for the rules that had been duplicated and drifted — `TENANT_SELECTABLE_SOURCE_TYPES` (`order`, `subscription`; `internal_overhead` is ops headroom, never a customer allowance), `remainingMinutesForGrant()` (Infinity for `isUnbounded`, matching what `getRemainingMinutes()` always did) and `hasProvisionableMinutes()`.
- `doProvisionMeeting()`: selection now uses a **positive** `sourceType IN (:...sourceTypes)` clause (not `!= 'internal_overhead'`, so a future third source type cannot slip through by default), the minutes gate calls `hasProvisionableMinutes()`, and a failure-path probe distinguishes **"allowance exhausted"** from **"no allowance at all"** — the two previously produced the same message.
- `GrantReaderService.getRemainingMinutes()` now uses the same helper and excludes `internal_overhead` (counting overhead would report every organization as unbounded). Both call sites therefore cannot drift again.

**Runtime reproduction (2026-09-23) — the evidence this entry previously lacked.** The three new cases in `bbb-meeting-concurrency.e2e-spec.ts` were first executed against the **pre-fix** worker; all three failed with exactly the documented symptoms:

| Case (real Postgres) | Pre-fix behaviour | Post-fix |
|---|---|---|
| Only grant is the auto-created `internal_overhead` grant | `"No minutes remaining on plan"` (failure mode 1) | `"No active capacity grant found for this organization…"` |
| Commercial grant at its limit (`exhausted = true`) | `"No active capacity grant found…"` — an exhausted allowance reported as *missing* (failure mode 2) | `"Your plan's meeting minutes for this period are exhausted. Please purchase or renew a plan to continue."` |
| Tenant-selectable grant with `isUnbounded: true` and the `-1` sentinel | `"No minutes remaining on plan"` (the `-1 − consumed ≤ 0` arithmetic) | Reaches the BBB transport (gate passed) |

Post-fix: `bbb-meeting-concurrency.e2e-spec.ts` **4/4** and `grant-selection.policy.spec.ts` **8/8** (infra-free).

**Related but distinct — resolved.** `GrantReaderService.findEarliestValidGrant()` filtered only on `exhausted` and ordered by `validUntil`, ignoring its declared validity window *and* its `_sourceTypes` parameter. Re-verified with `grep -rn findEarliestValidGrant src/`: a single occurrence — its own definition — so it was dead code rather than a live path (the same was true of `getRemainingMinutes()`, which had no callers either; `doProvisionMeeting()` was the only live enforcement point). It was **deleted** in `d711940` rather than repaired, so the bug family cannot be reintroduced through it. The planned F-7 rule (a provider-free subscription must keep `currentPeriodStart`/`currentPeriodEnd` NULL so the paid renewal scan does not discover it) is a design constraint for the Free Basic activation slice, not part of this defect. Both are tracked in `saa9vi-comprehensive-integration-and-commercial-plan.md` §0.19.

---

## BUG-037 — `bbb-channel-isolation.e2e-spec.ts` could not pass (harness drift) — ✅ FIXED (2026-09-24)

> **Status:** fixed and runtime-verified 2026-09-24 — `npm run test:e2e:bbb-isolation` → **13/13** against real Postgres. Found while re-running the BBB suites as regression cover for BUG-036; the spec itself was never touched by that fix (last modified in `48ad7c7`).

**Severity:** High (missing evidence, not live runtime behaviour) · **Discovered:** 2026-09-24 (first execution of the suite since `48ad7c7`) · **Components:** `src/plugins/bigbluebutton-plugin/__tests__/bbb-channel-isolation.e2e-spec.ts` only — **no product code changed**.

**Why it matters.** This suite is the runtime evidence cited for **INV-001** (cross-tenant channel isolation) by `docs/architecture/security.md` §SEC-002 and `docs/adr/platform-adr.md`. It had silently become impossible to pass, so the "Phase A isolation suite green" claim rested on a suite that could not execute — the same class of drift BUG-033 fixed for the other specs.

**Symptom.** `7 failed / 6 skipped (13)`. The first failure was `registerNewTenant` → `The permission "CreateCmsArticle" may not be assigned`; every later failure was a cascade of `undefined` variables from that. Once registration worked, the next layer surfaced: `createBbbOrganization` → `You are not currently authorized to perform this action`.

**Root causes (three, all harness-side).**

1. **Missing plugins.** The spec loaded `plugins: [TenantPlugin, BigBlueButtonPlugin]`, but `TENANT_ADMIN_ROLE_PERMISSIONS` grants CMS (`CreateCmsArticle`, …) and Reviews (`ReviewAdmin`) permissions, and Vendure rejects any permission that no loaded plugin has registered — so `registerNewTenant` failed while creating the tenant-admin role. Fixed by loading the set that makes the green `tenant-plugin.e2e-spec.ts` pass: `CmsPlugin`, `ReviewsPlugin`, `SubscriptionPlugin.init({})` (the subscription tables are additionally required by ADR-043's theming gate, which `TenantPlugin` reads via `TransactionalConnection`).
2. **Missed the BUG-033 fix.** `@vendure/testing`'s `testConfig` defaults `authOptions.requireVerification: true` while `registerNewTenant` creates admins with `user.verified = false`, so tenant-channel logins returned a null `CurrentUser`. BUG-033 added `requireVerification: false` to the marketplace / tenant-plugin / customer-deletion specs — **this spec was missed**. Added here.
3. **An org-creation phase that could not work.** Phase 2 created the org via `createBbbOrganization` as SuperAdmin:
   - `beforeAll` called `adminClient.asSuperAdmin()` **without `await`**. That is a login round-trip (`createTestEnvironment` does not pre-authenticate the admin client), so the mutation raced the login, ran unauthenticated, and Vendure returned its generic `ForbiddenError` (`RequestContext.userHasPermissions()` is false with no user). Vendure's SuperAdmin role was never the problem — `ensureSuperAdminRoleExists()` grants it all permissions, and `Permission.SuperAdmin` is `assignable: true`.
   - it then called `setChannelToken('')`, leaving `ctx.channelId` unset — and `userHasPermissions()` returns `false` outright when there is no channel, so even an authenticated SuperAdmin fails every `@Allow(...)` check.
   - the org already existed anyway: `BbbTenantProvisioningListener` provisions it on `TenantRegisteredEvent` using a ctx **scoped to the tenant channel**, which is required because `BbbOrganizationService.create()` calls `assignToCurrentChannel()` — a default-channel ctx mis-assigns the `channels` join (the BUG-004 / BUG-031 class).

   Phase 2 now asserts the real production path instead: each tenant channel resolves to exactly one organization, polled until the async listener has written it (same pattern as `marketplace.e2e-spec.ts`'s `ensureOrg`).

**Also corrected — latent assertions that could never have passed.** The spec compared the GraphQL `channelId` field against the *decoded* internal id: the API boundary encodes ids (`T_2`) while `tenantAChannelId` was normalised to `2` for repository reads (`channelId.replace(/^T_/, '')`, line 212). Both forms are now explicit — `tenantAChannelId` (internal, for repository reads) and `tenantAChannelIdEncoded` (GraphQL) — and all GraphQL assertions use the encoded form.

**Evidence (same machine, same Postgres, 2026-09-24).**

| Stage | Result |
|---|---|
| Pre-fix (as committed) | `7 failed \| 6 skipped (13)` |
| After root causes 1 + 2 | `5 failed \| 8 passed (13)` — registration and all six isolation cases green |
| After root cause 3 + id-form correction | **`13 passed (13)`** — `npx tsc --noEmit` exit 0 |

---



| Field | Detail |
|---|---|
| **ID** | BUG B |
| **Severity** | Critical |
| **Found** | 2026-09-20 (R2-E probe, pre-ADR-041 code) |
| **Fixed** | 2026-09-20 (ADR-041 G2–G7) |
| **Status** | ✅ Fixed and runtime-verified (R2-E run, subscription 7, 2026-09-20) |

### Description

The R2-E authorization probe demonstrated a concrete billing defect: one real ₹100 Razorpay Test payment produced a local subscription period **two months** in the future.

```
Razorpay provider cycle:  2026-09-20 → 2026-10-20
Saa9vi local result:      2026-11-16 → 2026-12-16   ← wrong by ~2 months
```

### Root cause

`finalizeAfterPayment()` computed the new billing period by arithmetic on the local `currentPeriodEnd`:

```ts
// PROHIBITED — the exact mechanism behind the drift
const newPeriodEnd = new Date(sub.currentPeriodEnd);
newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
```

Because the local `currentPeriodEnd` had drifted from the provider cycle during the initial authorization flow, this arithmetic produced a period two months ahead of the actual provider cycle. The same mechanism made replay non-idempotent: a replayed webhook would advance the period a second time.

The out-of-order failure guard in `markPastDueFromWebhook()` had a related flaw — it compared `currentPeriodEnd > new Date()` (wall clock) rather than comparing the provider cycle identity.

### Fix — ADR-041 G2–G7 (2026-09-20)

The provider cycle (`current_start` / `current_end` from Razorpay's subscription entity) is now the **authoritative identity** of every paid period. No local arithmetic substitutes for it on the provider-driven path.

Key changes (G2–G7, runtime-verified 2026-09-20):
- `NormalizedBillingEvent` carries `providerPeriodStart`/`providerPeriodEnd`; `assertProviderCyclePresent()` throws fail-closed before any mutation if fields are absent
- `subscription.charged` cycle validation is **unconditional** — `assertProviderCyclePresent` fires for every charged event regardless of `providerPaymentId` / `amountPaise` truthiness, satisfying INV-020's fail-closed requirement
- `SubscriptionBillingAttempt` gains nullable `billingPeriodEnd` (migration `1789883158253`); `billingPeriodStart` made nullable (migration `1789885988242`); **uniform NULL semantics** — initiated rows carry `NULL` in both period fields (renewal worker no longer passes a provisional local date); failed attempts without a provider cycle are also `NULL`; the `recordAttemptInitiated()` signature updated to reflect `billingPeriodStart` as optional
- `finalizeAfterPayment()` reads `billingPeriodStart`/`billingPeriodEnd` from the attempt row; absent `billingPeriodEnd` → reconciliation incident (no fallback)
- Cycle-monotonic CAS (`currentPeriodStart < :targetStart`) enforces monotonic progression
- `markPastDueFromWebhook()` uses cycle-identity freshness guard (`providerCycleStart <= localCurrentPeriodStart` → stale no-op)
- `updateBinding()` transactional; binding lookup provider-qualified

See `docs/architecture/adr-041-provider-cycle-billing-period-identity.md` for the full decision record.

### Runtime verification

The fix is runtime-verified by the R2-E run (2026-09-20):
- Subscription 7, channel 13, `sub_TeJjWjzzC0dU4W`, payment `pay_TeJk63hHNo32gI`
- `billingPeriodStart = 2026-09-20` ✅ matches Razorpay `current_start = 1789913044`
- `billingPeriodEnd = 2026-10-19` ✅ matches Razorpay `current_end = 1792434600`
- `OrganizationSubscription.status = active` ✅
- `currentPeriodStart = 2026-09-20T00:00:00.000Z` ✅ from provider cycle, not local arithmetic
- No +1 month drift ✅

---

## BUG-038 — `bbbFulfillmentHandler` read `order.lines`, which Vendure never loads — **every** `addFulfillmentToOrder` failed with `CREATE_FULFILLMENT_ERROR` — ✅ FIXED (2026-09-25)

> **Status:** fixed and runtime-verified 2026-09-25. Found while producing the
> Slice 10 / R4 runtime-lifecycle evidence (case **R4-02**); the pre-fix failure
> was reproduced at runtime before the fix.

**Severity:** Critical (the `order`-source capacity grant could never be written, so a paid order could never provision a meeting) · **Discovered:** 2026-09-25 (runtime) · **Components:** `src/plugins/bigbluebutton-plugin/config/bbb-fulfillment.ts` (`createFulfillment` only — no entity, no migration)

**What the code did.** `createFulfillment()` derived each line's product variant from the `order` object it is handed:

```ts
const orderLine = order.lines.find((l) => String(l.id) === String(line.orderLineId));
const productVariantId = orderLine?.productVariant?.id;
```

Vendure does not give a fulfillment handler an order with `lines` loaded. The `order` arrives from `FulfillmentService.getOrdersFromLines()`, which loads `relations: ['order', 'order.channels']` **only** — `order.lines` is `undefined`. The `&&` chain therefore never defended anything: `.find` is called on `undefined` and throws `TypeError: Cannot read properties of undefined (reading 'find')`.

**Why nobody noticed.** The throw happens *inside* the handler, so Vendure wraps it and the Admin caller only sees `CREATE_FULFILLMENT_ERROR` with no stack — indistinguishable from a bad input. The only consumed consequence, the `BbbCapacityGrant` write, is intentionally idempotent and silent (it logs at `info`), so nothing downstream failed loudly: the fulfillment row was simply never created and no capacity was granted.

**Why it matters.** Writer (B) of the three capacity-grant writers is the *purchase* path — `addFulfillmentToOrder` → `bbbFulfillmentHandler` → `BbbCapacityGrant(sourceType: 'order')`. With it dead, the only grants any tenant organization could hold were the auto-created `internal_overhead` grant and subscription grants. Combined with BUG-036's rule that `internal_overhead` is never tenant-selectable, a customer who paid for a session could not provision a meeting **at all** — the purchase → entitlement → BBB chain was severed at exactly the point Slice 10 exists to prove.

**Fixed.** The line is now resolved from the handler's own `lines` input, following Vendure's canonical `digitalFulfillmentHandler` in the Digital Products guide, and hoisted **out of the per-line loop** into a single batched query:

```ts
const resolvedLines = await connection.getRepository(ctx, OrderLine).find({
  where: { id: In(lines.map((l) => String(l.orderLineId))) },
  relations: { productVariant: true },
});
```

`order.lines` is no longer read anywhere in the handler. One query regardless of line count, and `productVariant` is loaded explicitly because the fulfillment handler has no other reason to have it.

**Runtime reproduction and verification (2026-09-25).** R4-02 calls the real Admin `addFulfillmentToOrder` against real Postgres. Pre-fix it fails with `CREATE_FULFILLMENT_ERROR`; post-fix it writes the grant and the change is causally load-bearing — R4-04 then provisions a meeting selecting **`grantId` of the `order` grant, not the overhead grant**:

| Evidence (real Postgres, `R4_E2E=true`) | Observed |
|---|---|
| R4-02 — Admin `addFulfillmentToOrder` | `grant=2 sourceType=order grantedMinutes=600 orderLineId=1 fulfillment=T_1` |
| R4-04 — provisioning selects it over `internal_overhead` | `meeting=1 state=Active session=1 status=LIVE grantId=2` |
| R4-08 — usage ledger binds to that same grant | `ledgerRows=1 consumedMinutes=11 grant=2 grant.consumedMinutes=11 session=FINISHED` |

BUG-036 declared `internal_overhead` unselectable, which is what makes R4-02 a hard prerequisite of R4-04: had the grant write still been broken, provisioning would have failed on an empty selectable set rather than silently borrowing ops headroom.

---

## BUG-039 — Tier 2 of the capacity-policy cascade was schema-blind: the raw `organization_subscription` query resolved through `search_path` instead of the configured schema — ✅ FIXED (2026-09-25)

> **Status:** fixed and runtime-reproduced 2026-09-25. Found while producing the
> Slice 5 plan-derived-concurrency evidence; the pre-fix failure is reproduced by
> three cases of `plan-derived-concurrency.e2e-spec.ts`.

**Severity:** High (silently wrong resolution — no error, no log) · **Discovered:** 2026-09-25 (runtime, while producing the Slice 5 evidence) · **Components:** `src/plugins/bigbluebutton-plugin/services/bbb-platform-capacity-policy.service.ts` (`getEffectivePolicy`, Tier 2 only) — no entity, no migration

**What the code did.** Tier 2 of the 4-tier cascade looks up the channel's active subscription with a raw query:

```ts
const subRows = await this.connection.rawConnection.query(
  `SELECT "planId" FROM "organization_subscription"
    WHERE "channelId" = $1 AND "status" IN ('trialing', 'active')
    ORDER BY "updatedAt" DESC LIMIT 1`,
  [channelId],
);
```

The two paths disagree about schema resolution:

| Path | Resolves via | Result when `dbConnectionOptions.schema` is set |
|---|---|---|
| TypeORM **entity** query (`repo.findOne`) | the connection's `schema` option | `"e2e_plan_capacity"."organization_subscription"` |
| **Raw SQL** string | the connection's `search_path` | `public.organization_subscription` |

`search_path` is **not** derived from `schema` — TypeORM sets `searchSchema` from the DB's `current_schema()`, so the two never agree once a schema is configured.

**Failure modes.**

1. **Silent wrong resolution.** In any schema-configured deployment the raw query reads a table that has no matching row, so `planId` comes back `undefined`, Tier 2 declines, and the cascade falls through to Tier 3/4 — `source` resolves to `fallback` instead of `plan` and the plan-derived ceiling never applies. No throw, no log line; the code path looks exercised and correct.
2. **Downgraded failure.** If the bare table does not exist in `search_path` at all, the `relation does not exist` throw is caught by Tier 2's own `try/catch` and reduced to a `Logger.warn` — so even the error case is silent, and the cascade continues as if the subscription had simply not matched.

**Why it matters now.** Slice 5's entire mechanism *is* Tier 2: Free Basic = 1 concurrent room is read from the plan-matched policy row. Under this bug the feature only ever worked when `schema` was left unset, which is the production default — so the defect was invisible in production and only surfaced on the first schema-isolated e2e run. Any deployment that does set `dbConnectionOptions.schema` would have shipped a plan-derived limit that never converges.

**Diagnosis (2026-09-25).** A direct SQL probe settled it rather than inference: the seeded rows were in `e2e_plan_capacity.organization_subscription` while `public.organization_subscription` held no row for that channel — exactly the split the table above predicts.

**Fix (2026-09-25).** A private `subscriptionTableRef` getter qualifies the table name with `connection.rawConnection.options.schema` when one is configured, and falls back to the bare name when it is not:

```ts
private get subscriptionTableRef(): string {
  const schema = (this.connection.rawConnection.options as { schema?: string }).schema;
  return schema
    ? `"${schema}"."organization_subscription"`
    : `"organization_subscription"`;
}
```

Tier 2's query interpolates `${this.subscriptionTableRef}`. Production (no `schema` configured) is byte-for-byte the same statement as before; schema-configured runs now read the same table the entity path does. This is the **only** raw query under `src/` outside migrations — verified by search — so the fix covers the whole raw-SQL surface.

**Runtime reproduction and verification (2026-09-25).** `PLAN_CAPACITY_E2E=true npx vitest run … plan-derived-concurrency.e2e-spec.ts` against real Postgres:

| | Result | Failing cases |
|---|---|---|
| Pre-fix | **2 passed / 3 failed** | derives Free Basic (tier 1) `concurrentMeetingLimit = 1` from the plan policy; re-derives the new ceiling when the plan changes; startup reconciliation repairs stragglers and is idempotent |
| Post-fix | **5 passed / 5** | — |

The two that passed pre-fix are the `isPlanDerived()` guard truth-table case (a pure predicate, no DB) and the Admin-value-preservation case (its Tier 2 lookup finds a plan that has **no** policy row, so the cascade falls through to Tier 3/4 whether or not the raw query succeeds) — neither assertion is sensitive to the defect, making them a clean control group for the diagnosis. Gates on the fixed tree: `npx tsc --noEmit` 0, `npm run lint` 0, `npm run build` 0, `npm run verify:invariants` convergence **100/100** with **0 warnings**.

---

## BUG C — `subscribeToPlan` Initial Period Blocked ADR-041 CAS (fixed 2026-09-20)

| Field | Detail |
|---|---|
| **ID** | BUG C |
| **Severity** | Critical |
| **Found** | 2026-09-20 (R2-E runtime run) |
| **Fixed** | 2026-09-20 (commit `cd3a80f`) |
| **Status** | ✅ Fixed and runtime-verified |

### Description

`subscribeToPlan` created the `OrganizationSubscription` row with:

```ts
currentPeriodStart: now,   // e.g. 2026-09-20T13:01:13.619Z
currentPeriodEnd:   periodEnd,
```

The ADR-041 cycle-monotonic CAS condition is:

```sql
WHERE currentPeriodStart IS NULL OR currentPeriodStart < :targetStart
```

The provider webhook supplies `current_start` as a Unix timestamp that normalises
to a UTC calendar date (e.g. `2026-09-20T00:00:00.000Z`). Because the creation
timestamp (`13:01:13`) was always *after* midnight on the same day, the CAS
condition `currentPeriodStart < targetStart` evaluated to `false` — the finalization
was silently rejected as "not a newer cycle" and the subscription remained stuck in
`pending_provider_auth`.

Evidence: subscription 5 (channel 21, pre-fix) stayed `pending_provider_auth` even
after all three webhooks processed cleanly. Subscription 7 (channel 13, post-fix)
correctly transitioned to `active` with `currentPeriodStart = 2026-09-20T00:00:00.000Z`.

### Fix

Set `currentPeriodStart = NULL` and `currentPeriodEnd = NULL` at creation. The `IS NULL`
branch of the CAS fires correctly for the first provider webhook, and the period is
written from the authoritative provider cycle (`current_start`/`current_end`).

### Runtime verification

- Subscription 7, channel 13, `sub_TeJjWjzzC0dU4W`
- `currentPeriodStart = 2026-09-20T00:00:00.000Z` ✅ (from provider cycle)
- `currentPeriodEnd = 2026-10-19T00:00:00.000Z` ✅ (from provider cycle)
- `status = active` ✅
- `version = 2` ✅

---

## Active Integration Gaps

**Confirmed external-dependency mismatches that are not application bugs.** These block a production gate but the Saa9vi-side state machine is verified correct; the external dependency's configuration/behavior compatibility remains unresolved.

| ID | Severity | Component | Description | Status |
|---|---|---|---|---|
The BBB provisioning/join integration investigation (BBB-INT-001) is **resolved** — the reported `getMeetingInfo error.forbidden` was a stale-meeting artifact, not a defect.

## Closed: BBB-INT-001 (stale-meeting artifact)

| ID | Severity | Component | Description | Status |
| --- | --- | --- | --- | --- |
| BBB-INT-001 | Medium | BBB provisioning/join integration | Reported `getMeetingInfo error.forbidden` on provisioning-created meetings. **Resolved:** manual BBB control meeting (create/getMeetingInfo/join) and fresh Saa9vi-provisioned meetings (`bbb-10`) both return `getMeetingInfo SUCCESS` at t+0/1s/3s/10s. Expired/stale meetings correctly return `notFound`. No checksum, API-secret, endpoint, or provisioning defect reproduced. The existence validator's fail-open handling of ambiguous errors remains a reasonable availability measure; Saa9vi authorization gates (entitlement + LIVE + Active meeting) are unaffected. | ✅ Closed (2026-09-15) |

Diagnostic evidence: `scripts/diagnostics/bbb_diag.mjs` (read-only BBB protocol replica; diagnostic-only — it reads PostgreSQL directly and is **not** an application data-access pattern; application code must use Vendure services + `RequestContext`).

## Related fix (same-day): session channel stamping

`BbbScheduledSessionService.create()` stamped `channelId` from the request context instead of the organization. A superadmin creating a session for a channel-14 org under a channel-15 token produced a channel-mismatched session (FORBIDDEN at `startScheduledSession`). Fixed: the session's tenant scope is now derived from `organization.channelId` (INV-001 authoritative aggregate).

## Fixed (same-day): join-URL generation `error.forbidden` (type coercion)

| ID | Severity | Description | Fix |
| --- | --- | --- | --- |
| BBB-BUG-002 | High | `getJoinUrl` for an entitled learner in the meeting's own channel threw `ForbiddenError` (`error.forbidden`): `assertMeetingAccess` compared `meeting.organization.channelId !== ctx.channelId` with strict `!==` — numeric ctx channelId vs string denormalized column never matched. `assertSessionAccess`/`assertRoomAccess` already coerced with `String()`; `assertMeetingAccess` did not. | Normalized both sides with `String()` in `assertMeetingAccess`. Proven: learner dashboard now returns `canJoin=true, ctaAction=join, joinUrl != null` and the join URL redirects into BBB's HTML5 client (session token issued). |

## Clarified (same-day): unjoined meetings → BBB auto-destroy → Stale

BBB destroys meetings that are never joined after a server-side timeout. `BbbReconciliationService` correctly detects this (`getMeetingInfo` → `notFound`) and marks the meeting `Stale` (terminal, no usage ledger). The learner dashboard then correctly returns `ctaAction=none, joinUrl=null` for the affected session. This is **correct defense-in-depth behavior**, not a defect: fresh meetings return `getMeetingInfo SUCCESS` immediately after provisioning (t+0/1s/3s/10s proven).

---

## Fixed Bugs

| ID | Severity | Description | Fix |
|---|---|---|---|
| BUG-001 | Critical | `TenantProfileDetail.tsx` — `useState` instead of `useEffect`, form never populates on edit | ✅ Fixed |
| BUG-002 | Critical | `tenant-admin.resolver.ts` — `tenantProfile(channelId: '__current__')` always returns null | ✅ Fixed |
| BUG-003 | High | `BbbWebhookController` — webhook processed inline, no persist-first, no replay | ✅ Fixed |
| BUG-004 | High | `BbbOrganizationService.create` — `channels[]` join table never populated | ✅ Fixed |
| BUG-005 | High | `BbbOrderFulfillmentListener` — fulfillment resolved `productVariantId → BbbRoom`, not `→ BbbScheduledSession` | ✅ Fixed |
| BUG-006 | Medium | `Article`, `Page` entities — slug uniqueness application-level only, TOCTOU race | ✅ Fixed |
| BUG-007 | Medium | `PlansList.tsx` — `useEffect` dep on derived `organizations`, auto-select never fires | ✅ Fixed |
| BUG-008 | Medium | `BbbMeeting`, `BbbServer` — no `encryptionKeyVersion` column | ✅ Fixed |
| BUG-009 | Low | `BbbScheduledSession` — `(organizationId, slug)` composite unique missing | ✅ Fixed |
| BUG-010 | Low | Dashboard list pages (6 files) — `window.confirm` for destructive actions | ✅ Fixed |
| BUG-011 | Low | `MembersList.tsx`, `EnrollmentsList.tsx` — org auto-select never fires on first load | ✅ Fixed |
| BUG-012 | High | `constants.ts` — `STALE` meeting state absent from FSM | ✅ Fixed |
| BUG-013 | Medium | `BbbReconciliationService` — `CapacityExhaustedEvent` not published when `billingCapped = true` | ✅ Fixed |
| BUG-014 | Low | `BbbServerSelectionService` — `currentLoad` scoring semantics undocumented | ✅ Fixed — "Load score" relabel 2026-10-07: the fix doc had described a nonexistent `reconcileServerLoad()`; `bbb-server.entity.ts` now states the verified semantics (written at insert only, no runtime updater, jitter fallback, opaque to selection/capacity readers) |
| BUG-015 | Medium | `CmsPlugin`/`BannerService` — banner BullMQ queues not registered | ✅ Fixed |
| BUG-016 | High | `ReviewsPlugin`/`dashboard/index.tsx` — `navSections` uses `items` property (TS-2353) | ✅ Fixed |
| BUG-017 | Medium | `ReviewsPlugin` entities — `ProductReview`, `ReviewRequest`, `ReviewReport`, `ReviewReward`, `ReviewVote` did not implement `ChannelAware` — channel isolation relied solely on explicit `ctx.channelId` WHERE clauses in services. Fixed by adding `ChannelAware` (channels[] + channelId) to all 5 entities. | ✅ Fixed |
| BUG-018 | Medium | `BbbShopResolver.joinRoom()` — moderator role-routing has no trigger path | ✅ Fixed |
| BUG-019 | High | `LoadSimulationPlugin` — `runLoadTest` exposed on public Shop API (DoS vector) | ✅ Fixed |
| BUG-020 | Medium | `CausalMapper` — references non-existent `simulateBbbWebhook` resolver. Fixed the *reference* only (step returns `isPending: true`, skipped by LoadOrchestrator); the resolver itself remains unimplemented — see item 4 in `docs/adr-assessment.md`'s resolution table. | ✅ Fixed |
| BUG-021 | High | `TenantProfileService.create()` — `channelOrToken` passed as raw Channel entity instead of `channel.token` string | ✅ Fixed |
| BUG-022 | P0 | `bbb-shop.resolver.ts` — `bbbRoomStatus`, `myBbbRooms`, and `myBbbEnrollments` read from `BbbEnrollment` only, while `BbbOrderFulfillmentListener` writes `BbbEntitlement` for room purchases. Fixed by also reading from `BbbEntitlement` in all three methods. | ✅ Fixed |
| BUG-023 | P1 | `marketplace-indexer.service.ts` — `academySlug` hardcoded to `''`, `channelToken` set to raw `channelId` instead of `Channel.token`, `customDomain` not indexed. Fixed by resolving `Channel.token` and `BbbOrganization.slug` in both session and instructor indexing. | ✅ Fixed |
| BUG-024 | P2 | `TenantRegistrationService` — `ShippingMethod`/`StockLocation`/`PaymentMethod` not auto-provisioned for new channels. Fixed by adding `autoProvisionChannelResources()` that assigns default channel's methods/locations to the new channel. | ✅ Fixed |
| BUG-025 | Medium | `tenant-admin.resolver.ts` — Vendure's built-in `roles` query was implicitly channel-scoped. Fixed by overriding `roles` in `TenantAdminResolver` (SuperAdmin sees all, tenant admin channel-scoped). | ✅ Fixed |
| BUG-026 | Medium | `tenant-admin.resolver.ts` — Vendure's built-in `role(id)` and `administrator(id)` singular queries were implicitly channel-scoped, causing "not found" on the role/administrator detail pages for SuperAdmin. Fixed by overriding both singular queries in `TenantAdminResolver` (SuperAdmin sees all, tenant admin channel-scoped). | ✅ Fixed |
| BUG-027 | P1 | `product-review-shop.resolver.ts` — `pendingReviewRequests` accessed `options.take`/`options.skip` on `undefined`. Fixed by forwarding `options?.take`/`options?.skip`; the service already defaults take→10, skip→0. | ✅ Fixed |
| BUG-028 | Medium | `tenant-plugin/dashboard/index.tsx` — Academy Console nav items used incorrect permission identifiers (`TenantProfileRead`, `InstructorProfileRead`, `MediaResourceRead`) instead of the Vendure `CrudPermissionDefinition` generated names (`ReadTenantProfile`, `ReadInstructorProfile`, `ReadMediaResource`). Fixed by correcting the `academyPermissions` map. | ✅ Fixed |
| BUG-029 | High | `tenant-plugin/constants.ts` — `TENANT_ADMIN_ROLE_PERMISSIONS` included `BbbPlatformInfrastructurePermission`, granting tenant admins permission to manage BBB servers/platform capacity infrastructure (Portal/SuperAdmin-only per ADR-033). Fixed by removing it from the tenant role template. Existing roles with this permission can be cleaned up via `npm run tenant:roles:repair -- --remove-unexpected`. | ✅ Fixed |
| BUG-030 | Medium | `tenant-plugin/api/tenant-admin.resolver.ts` — administrators/administrator resolvers loaded `user.roles` but not `user.roles.channels`, so TypeORM returned `channels:[]` for tenant roles even though the role-channel join exists. This made the nested `user.roles.channels` graph inconsistent with the direct `roles` query. Fixed by loading `user.roles.channels` relations in the SuperAdmin branch and using `leftJoinAndSelect role.channels` in the tenant-admin branch; same fix applied to the singular `administrator(id)` resolver. Regression test added to the INV-016 e2e suite. | ✅ Fixed |
| BUG-031 | Critical | `src/plugins/cms/services/{page,banner,article}.service.ts` + `article.entity.ts` — CmsPlugin used Vendure's `assignToCurrentChannel()` which assigns an entity to the current channel AND the default channel, leaking tenant-created CMS content onto `__default_channel__` so it was visible to other tenants. Fixed by adding `CmsChannelAssignmentPolicy` (ADR-036): SuperAdmin → default channel only, Tenant Admin → tenant channel only (never default). Replaced `assignToCurrentChannel()` in `PageService`/`BannerService`/`ArticleService.create()`. Replaced non-working `ListQueryBuilder` channelId option in `findAll()` with explicit inner join on the `channels` relation. E2E: 44/44 pass, including new tests verifying tenant CMS isolation and platform CMS preservation. **Extended 2026-09-16 (same bug class, subscription domain):** `SubscriptionService.subscribeToPlan()`/`createProviderBinding()` used the same `assignToCurrentChannel()` helper, joining the platform default channel onto tenant-scoped `OrganizationSubscription`/`SubscriptionProviderBinding` rows. Replaced with tenant-only inline assignment (`channels = [channel]`, ADR-036 house policy); runtime-verified — tenant join rows are `{17}` only (no default-channel leak) and the Portal Admin Dashboard read path (channel-1 ctx) is unaffected, since `findAllSubscriptions` does not channel-filter unless `channelId` is passed explicitly. | ✅ Fixed |
| BUG-032 | Medium | `BbbSubscriptionListener` — not idempotent, writes multiple `BbbCapacityGrant` rows for the same billing period start. Fixed by adding existence check (`validFrom` + `sourceType: "subscription"`) before save. | ✅ Fixed |
| BUG-033 | High | e2e harness — admin login as a **tenant-channel** administrator failed with `Cannot return null for non-nullable field CurrentUser.id` (the login mutation returned a null CurrentUser). **Root cause found & fixed:** NOT channel resolution (as originally suspected) — `registerNewTenant` creates admins with `user.verified=false`, and `@vendure/testing`'s `testConfig` defaults `authOptions.requireVerification=true`, so Vendure returns a `NotVerified`/null CurrentUser for tenant-channel logins. SuperAdmin logins succeed only because seed users are pre-verified. **Fix:** `requireVerification:false` added to the e2e harness config in the marketplace spec (already present) and the **tenant-plugin + customer-deletion specs** (this change). Verified: marketplace Gate 1.5 suite **7/7 pass**; tenant-plugin suite **45/45 pass** (the 9 previously-blocked INV-016/CMS-isolation tests now run, exposing one real INV-016 gap fixed in `TenantAdminResolver` — SuperAdmin account leaked into tenant admin lists because Vendure's SuperAdmin role carries ALL channels; excluded via `SUPER_ADMIN_ROLE_CODE`). | ✅ Fixed |
| BUG-034 | High | `src/plugins/marketplace/e2e/commission.e2e-spec.ts` line 118 — `SetAddress` mutation declared with the incorrect GraphQL input type `AddressInput!` (a non-existent type). Vendure's Shop API declares `setOrderShippingAddress(input: CreateAddressInput!)`. The typo was introduced during a refactor of the test fixture and caused every test exercising the `setOrderShippingAddress` helper to fail at GraphQL validation time, blocking 6 commission E2E cases. **Root cause:** the original fixture used `AddressInput!`, but the actual Vendure contract requires `CreateAddressInput!`. **Fix:** corrected the mutation to `mutation SetAddress($input: CreateAddressInput!)`. Verified: commission E2E **6/6 pass** (positive, $0-row, INV-008 forge, replay, no-ref, single-use ref). Current source uses `CreateAddressInput!` matching the upstream Vendure schema. | ✅ Fixed |
| BUG-035 | High | `src/plugins/marketplace/e2e/commission.e2e-spec.ts` line 261 — the order-hydration query after `setOrderAddress` fetched the order without `relations: ['lines', 'surcharges']`, so `Order.lines` was empty. The INV-008 forged-reference test (`$0-row`) asserts that a forged `marketplaceRef` on an order with no matching resource lines is rejected; with an empty `lines` array the assertion `order.lines.some(l => l.productVariant.id === resourceVariantId)` always returned `false`, making the test pass for the wrong reason on a green-field DB but fail on any DB where real order lines existed from prior runs. **Root cause:** the hydration step was copied from a simpler fixture that didn't need line-level access and the relations array was never extended. **Fix:** added `relations: ['lines', 'surcharges']` to the order-hydration query. Verified: commission E2E **6/6 pass**, including the INV-008 forge case now correctly exercising the line-matching path. | ✅ Fixed |
| INV-008 | P1 | `src/lib/vendure/session-cta.ts` (deleted) + `learning-dashboard.service.ts` — `getSessionCta()` was a client-side entitlement isolation layer containing business logic (joinUrl precedence, trial eligibility, registration status) that violated the entitlement-only access invariant. Fixed by moving the CTA decision server-side: `LearningCourse` now carries server-driven `ctaAction`/`ctaLabel` computed in `LearningDashboardService.getDashboard()`. `course-card.tsx` renders these fields instead of re-deriving eligibility from the clock. `session-cta.ts` deleted. | ✅ Fixed |
| BUG-037 | High | `src/plugins/bigbluebutton-plugin/__tests__/bbb-channel-isolation.e2e-spec.ts` — the INV-001 "Phase A isolation" suite could not pass (7 failed / 6 skipped), so the isolation evidence cited by `security.md` §SEC-002 and `platform-adr.md` rested on a suite that could not execute. Three harness-only causes: (1) the spec loaded only `TenantPlugin` + `BigBlueButtonPlugin`, but `TENANT_ADMIN_ROLE_PERMISSIONS` grants CMS/Reviews permissions no loaded plugin had registered, so `registerNewTenant` failed with `The permission "CreateCmsArticle" may not be assigned`; (2) the spec never received the BUG-033 `requireVerification: false` fix, so tenant-channel logins returned a null `CurrentUser`; (3) phase 2 created the org as SuperAdmin via an **un-awaited** `adminClient.asSuperAdmin()` (login race → unauthenticated request → generic `ForbiddenError`) and `setChannelToken('')` (unset `ctx.channelId` → Vendure's `userHasPermissions()` returns false → every `@Allow` fails), while the org already existed — `BbbTenantProvisioningListener` provisions it on `TenantRegisteredEvent` with a tenant-scoped ctx, as `assignToCurrentChannel()` requires. Fix: load `CmsPlugin`/`ReviewsPlugin`/`SubscriptionPlugin` (the set the green tenant-plugin spec uses), add `requireVerification: false`, replace the creation phase with resolution of the real provisioning path (polled), and compare GraphQL `channelId` against the **encoded** form while repository reads use the decoded one. No product code changed. Verified: `npm run test:e2e:bbb-isolation` → **13/13** real Postgres (pre-fix 7 failed/6 skipped → 5 failed/8 passed → 13/13); `npx tsc --noEmit` exit 0. | ✅ Fixed |
| BUG-038 | Critical | `src/plugins/bigbluebutton-plugin/config/bbb-fulfillment.ts` — `createFulfillment()` resolved each line's product variant via `order.lines.find(...)`, but Vendure's `FulfillmentService.getOrdersFromLines()` hands the handler an order loaded with `relations: ['order', 'order.channels']` **only** — `order.lines` is `undefined`, so the `?.` chain never guarded and the call threw `TypeError: Cannot read properties of undefined (reading 'find')`. Vendure wrapped it, so the Admin caller saw only `CREATE_FULFILLMENT_ERROR` with no stack, and the sole consumed effect (an idempotent, `info`-level `BbbCapacityGrant` write) failed silently — meaning capacity-grant writer (B) `addFulfillmentToOrder → bbbFulfillmentHandler → BbbCapacityGrant(sourceType:'order')` was dead. With BUG-036 also making `internal_overhead` non-selectable, a customer who paid for a session could not provision a meeting at all. **Fix:** resolve lines from the handler's own `lines` input — `find({ where: { id: In(lines.map(l => String(l.orderLineId))) }, relations: { productVariant: true } })` — hoisted out of the per-line loop into one batched query, mirroring Vendure's canonical `digitalFulfillmentHandler` (Digital Products guide); `order.lines` is no longer read anywhere in the handler. Found and runtime-reproduced while writing the Slice 10 / R4 evidence: pre-fix R4-02 fails with `CREATE_FULFILLMENT_ERROR`; post-fix `[R4-02] grant=2 sourceType=order grantedMinutes=600 orderLineId=1 fulfillment=T_1`, and R4-04 proves it is load-bearing by provisioning `meeting=1 state=Active session=1 status=LIVE grantId=2` (the `order` grant, not `internal_overhead`), with R4-08 binding the ledger to the same grant. | ✅ Fixed |
| BUG-039 | High | `src/plugins/bigbluebutton-plugin/services/bbb-platform-capacity-policy.service.ts` — `getEffectivePolicy()`'s Tier 2 resolved the channel's active subscription with a **raw** `SELECT "planId" FROM "organization_subscription"`, which Postgres resolves through the connection's `search_path`, while every TypeORM **entity** query is qualified with the connection's `schema` option — and TypeORM does not derive `search_path` from `schema`. With `dbConnectionOptions.schema` set (every schema-isolated e2e run, and any such deployment) the raw query read a table holding no matching row, so `planId` came back `undefined`, Tier 2 declined, and the cascade fell through to Tier 3/4: `source` resolved to `fallback` instead of `plan` and plan-derived concurrency never applied — with no throw and no log. Had the bare table been absent from `search_path` entirely, Tier 2's own `try/catch` would have downgraded the error to a `Logger.warn` and continued anyway. Slice 5's whole mechanism *is* Tier 2, so the feature only worked while `schema` was unset (the production default), which is why it survived until the first schema-isolated e2e run. **Fix:** private `subscriptionTableRef` getter that qualifies the table with `rawConnection.options.schema` when configured and falls back to the bare name when not; Tier 2 interpolates it. No `schema` configured ⇒ byte-identical statement, so production is unchanged. Verified this is the only raw query under `src/` outside migrations, so the fix covers the whole raw-SQL surface. Diagnosis was direct SQL, not inference: the seeded rows sat in `e2e_plan_capacity.organization_subscription` while `public.organization_subscription` was empty for that channel. Found and runtime-reproduced while writing the Slice 5 evidence: pre-fix `plan-derived-concurrency.e2e-spec.ts` **2 passed / 3 failed** (the three Tier-2-dependent cases: Free Basic ⇒ 1, re-derive on plan change, startup reconciliation); the two that passed are insensitive to the defect by construction and act as a control group. Post-fix **5/5**; gates `tsc` 0, `lint` 0, `build` 0, `verify:invariants` 100/100 with 0 warnings. | ✅ Fixed |

