# Saa9vi — Vendure-Safe Task List for Cline

Nov 1, 2026 · @Ashish

## Progress review, 2 November 2026

Checked against `main` at commit `39174c5`. Items marked **read** I confirmed in the code. Items marked **per commit** rest on the commit message only. Overall: Phase 0 and 1 admission work and the learning-plugin scaffold are in, and the server boots. Tests, the payment fix, the admin UI and the domain work are not started. Four code bugs below should be fixed before more is built on top.

| Task | Status | Note |
| --- | --- | --- |
| C-00a checkpoint | Done | Merged to main. Tenant and learning plugins still declare `^3.0.0`. Raise both to `^3.7.0` (the strategy hook needs 3.7) |
| C-01 tenant profile isolation | Done (read) | Non-SuperAdmin callers are scoped to `ctx.channelId`, and a cross-channel update throws Forbidden. No cross-tenant test exists |
| C-02 admission workflow | Done (read) | Transition table, append-only log, five mutations, permission, migration. Follow-ups in NF5 |
| C-03 deletion and membership | Done (per commit) | Not re-read |
| C-04 strategy tests | Not started | No spec found |
| C-05 platform Razorpay exposure | Not started | ADR-051 is still an open stub. `autoProvisionChannelResources` still assigns the platform Razorpay method to every new tenant channel (read). Needs your answer on D11 |
| C-06 roles | No evidence | Permission added to the tenant admin role per commit. Run `tenant:roles:check` |
| C-07, C-11, C-12, C-16, C-17 documents | Done | Files exist under `docs/architecture` |
| C-08 webhook negative tests | Not started | Only the three older payment specs exist |
| C-09, C-10 id utils and admission port | Done (per commit) | `LearnerAdmissionModule`, port, `id-utils.ts` exist |
| C-14 suspension semantics | Open | ADR-052 says decision required (D4) |
| C-18 enrollment to entitlement conversion | Done (per commit) | Room-access source 4 is correctly kept until the conversion runs on live data |
| C-21 to C-28 learning scaffold | Done | Registered, migration made by the CLI and schema-only (read) |
| N-02 myCourses | Done, follow-up | NF4 |
| N-03 channel scoping | Done (read) | Course checked first in every enrollment path, announcement create verifies the course, publish is idempotent |
| N-04 session link | Done (read) | Uses a string-named `BbbScheduledSession` lookup, not a port. Works, but see NF8 |
| N-05 learner access | Partial | NF3 |
| N-06 typed inputs and role control | Not started | `input: any` remains and any role can be assigned |
| N-07 tool registration | Done | Four built-in tools plus `videoconference` from BBB, through a shared registry module (no circular import) |
| N-08 admin API completeness | Not started | NF2 |
| N-09 deletion handlers | Done, wrong | NF1 |
| N-10 ids, migration, tests | Partial | Migration done. Still open: compatibility range, `@EntityId()`, schema type names (NF7), any tests, `test:e2e:learning` |
| N-11, N-12, N-13 | Not started | Course product link, per-tenant payments, API coverage matrix |
| N-14, N-15, N-16 | Not started | ADR-049 already records slug hostnames as retired. See NF6 and the N-15 correction |
| UI-01 to UI-13 | Not started | No dashboard page exists for learners, courses or domain, and `LearningPlugin` has no `dashboard` entry |
| F-01 to F-06, C-29 | Not started | `edu-frontend` is not in this repo |

### New findings from the code

| ID | Severity | Finding | Fix in |
| --- | --- | --- | --- |
| NF1 | High | The learning deletion handler matches `authorId` and `createdByUserId` against the **Customer** id, but those columns store **User** ids (`ctx.activeUserId`). When the numbers coincide it anonymises another person's authorship, and real authors are never matched | N-09: look up the customer's user id first, or drop the authorship blocks since authors are staff |
| NF2 | High | `LearningCourseAdmin.tools`, `LearningCourseAdmin.enrollments` and `CoursePage.tools` are non-null in the schema, but no field resolver exists. Any query that selects them fails | N-08: add `@ResolveField` resolvers and test with `curl` |
| NF3 | Medium | `coursePageAnnouncements` checks ENROLLED but not ACTIVE admission or a PUBLISHED course, although the commit message says N-05 covers both | N-05 |
| NF4 | Medium | `myCoursePages` loads every course in the channel and filters in memory, and skips the admission check, so a suspended academy member still sees the list | N-02: query by the enrolled course ids and check admission |
| NF5 | Medium | `admitTenantLearner` does not check that the customer belongs to the channel. `tenantLearners` returns ids only (no name, email or phone) and accepts any `take`. UI-02 cannot be built until it returns customer details | New task C-02b: verify channel, add a customer summary field, use `ListQueryBuilder` with a capped `take` |
| NF6 | High | The custom-domain Redis mapping is written with a 7-day expiry and nothing renews it. A tenant's storefront falls back to the default channel a week after the domain is set. Check whether the storefront's channel route compensates | N-16 |
| NF7 | Low | The Admin schema uses generic names (`CreateCourseInput`, `UpdateCourseInput`, `EnrollLearnerInput`). You already hit one name collision, and the next plugin to use these names will break boot | N-10: prefix with `Learning` |
| NF8 | Low | N-04 depends on the string `'BbbScheduledSession'`. A rename would break it silently | Add a test now |

**Correction to N-15.** I said no uniqueness check was visible. The database already has a unique `customDomain`, so one tenant cannot overwrite another's mapping. The remaining risk is squatting: any tenant can claim a domain it does not own, which locks out the real owner. N-15 is now about ownership proof only.

**Recommended next three steps:** (1) fix NF1 to NF4 and NF7, which are small. (2) Decide D11 and do C-05, because the payment exposure is live for every new tenant. (3) Write the missing tests (C-04, N-10 e2e, C-08) before starting the admin UI.

## 1. Ground rules for Cline

**Standing constraints (do not relax)**

- **Data mutations:** never edit database rows by hand. Every data change goes through the Shop or Admin GraphQL API, using `curl` or a standard HTTP client.
- **Schema:** only through `npx vendure migrate`. One migration per schema-changing task, created with `--generate <name>`. Read `up()` and `down()` before applying. Migrations hold schema changes only, never data statements. Keep `synchronize: false`. Run `npx vendure migrate --help` first to confirm the flags.
- **Business rule:** Saa9vi never collects or holds seller payments.
- **Reference docs:** Vendure docs (`llms.txt`) and the core repo, Razorpay `llms-txt`, the BigBlueButton PHP API for call and checksum logic, and the BBB plugins README.

**How to work each task**

1. Task ids: `C-xx` ids come from the existing execution plan (the Kiro baseline names C-00 to C-29). `N-xx`, `UI-xx` and `F-xx` are new in this list. Reconcile with the plan file first and do not renumber.
2. Write the failing test first. For anything tenant-scoped, the first test is the cross-tenant attempt.
3. Implement, then run `npm run lint`, the matching `npm run test:e2e:*` script and `npm run verify:invariants`.
4. Prove API behaviour with `curl` against the Admin or Shop endpoint. Paste request and response into the progress log.
5. One commit per task, one entry in the progress log.

**Vendure-safe rules (never break)**

- **Extend, never replace.** No new resolver may reuse the name of a core query or mutation. Four already do (`administrators`, `administrator`, `roles`, `role`). They stay, get documented in C-16, and get a regression test on every Vendure upgrade. Prefix new operations with their module (`tenantLearner…`, `learningCourse…`).
- **Tenant = Channel.** Read the channel from `ctx.channelId`, never from client input. Any child lookup (enrollment, announcement, session link) first proves its parent belongs to `ctx.channelId`.
- **Resolvers:** `@Allow(<permission>)` on every operation, `@Transaction()` on every mutation. Services use `TransactionalConnection.getRepository(ctx, Entity)` so their work joins the request transaction.
- **Permissions:** register through `config.authOptions.customPermissions`. After adding one, add it to `TENANT_ADMIN_ROLE_PERMISSIONS` and run `npm run tenant:roles:repair`. Never edit core roles.
- **IDs:** references to Vendure entities use `@EntityId()`, not plain `varchar`, so they follow the configured entity-id strategy.
- **Lists:** use `ListQueryBuilder` for paginated, filterable, sortable lists, and cap `take`.
- **Payments:** Vendure `PaymentMethod` plus the one `razorpay` handler and the one `PaymentWebhookEvent` inbox. No second handler, controller or inbox.
- **Orders:** react to `OrderStateTransitionEvent` through the EventBus. Add no order states.
- **Access control:** `entityAccessControlStrategy` stays unset. `customerChannelAssignmentStrategy` is an invite-only channel-membership hook, never an authorization check. Authorization is an ACTIVE `TenantLearnerMembership`, checked in services.
- **Do not duplicate** (Kiro baseline section 14): the Razorpay handler and webhook controller, `PaymentWebhookEvent`, BBB webhook auth, `BbbRoomAccessService`, the `CustomerDeletionService` registry, `TenantLearnerMembership`, `TenantChannelAssignmentStrategy`.

**Your four-step action plan, mapped to tasks**

| Step in your plan | Where it lands |
| --- | --- |
| 1. Backend and GraphQL schema audit | N-13 (coverage matrix) and every migration task |
| 2. BBB service porting | Already built in `BbbApiService`. C-07 audits it against the PHP library. F-04 is the join flow |
| 3. Razorpay handler and webhooks | Handler and webhook exist. C-05, C-08 and N-12 close the gaps |
| 4. Next.js storefront sync | C-29 and F-01 to F-05 |

## 2. Vendure compatibility review

Each row is a place where the plan touches a Vendure default. **Checked** means I confirmed it in the Vendure docs this session. **Not checked** means I could not reach the page (the docs fetch limit was hit), so Cline must confirm it on docs.vendure.io before relying on it.

| Plan item | What Vendure does by default | Safe approach | Docs |
| --- | --- | --- | --- |
| `TenantChannelAssignmentStrategy` | Decides only whether a customer is assigned to a channel. It does not block API requests, and it is skipped at registration and checkout. The strategy hook needs Vendure 3.7.0 or later | Keep it as the invite-only channel-membership hook. Commit its registration. Raise plugin `compatibility` to `^3.7.0`. Never treat it as authorization | Checked |
| Learner authorization | No per-channel learner status exists. Customers are channel-aware, users are global | ACTIVE `TenantLearnerMembership`, read through `LearnerAdmissionPort` inside services | Design |
| Four same-name resolvers (`administrators`, `administrator`, `roles`, `role`) | A resolver with the same name replaces the core one for that field | Keep the four, document them (C-16), regression-test on upgrade. Add no new ones | Checked |
| New permissions (`TenantManageAdmissions`, `CourseManage`, `CourseEnroll`, `CourseAnnouncement`) | Custom permissions are registered in `authOptions.customPermissions` and must then be granted to roles | Register in the plugin `configuration` hook. Add to tenant admin role permissions. Run `tenant:roles:repair` | Checked |
| Per-tenant Razorpay | `PaymentMethod` is channel-aware. Handler arguments are stored as `simple-json`. One handler can back many payment methods | One `PaymentMethod` row per tenant channel. Resolve that tenant's Razorpay credentials by `ctx.channelId` from an encrypted store. Put no secrets in handler args. Stop assigning the platform method to tenant channels | Args storage checked. Encryption of args **not checked** |
| Offline or tenant-collected payments | Admin API has a manual payment mutation for orders | Use it for offline payments. Confirm the exact mutation name and permission by introspection on the dev server | **Not checked** |
| New entities referencing Customer, Channel, Order | `@EntityId()` makes id columns follow the configured `EntityIdStrategy` | Use `@EntityId()` for those references. Plain `varchar` ids work only while ids are integers | Checked |
| Migrations | `synchronize` off, schema changes through the CLI, plugin entities need migrations | One migration per task, reviewed, no data statements | Checked |
| Order paid, grant access | Order state changes publish `OrderStateTransitionEvent` on the EventBus | Keep the BBB listener. Make every grant idempotent | Checked |
| Admin UI | Plugins point `dashboard` at a file that calls `defineDashboardExtension` with nav sections and routes | Follow the existing plugins (BBB, Tenant, CMS). No edits to core dashboard pages | Repo pattern only. API details **not checked** |
| Custom list queries | `ListQueryBuilder` gives pagination, filter and sort in the standard shape | Use it instead of hand-written `skip` and `take` | Not re-checked this session |
| `ChannelAware` entities | Core entities such as products carry a many-to-many link to channels | The repo uses a plain `channelId` column on plugin entities. Acceptable if every query filters on it. Keep that consistent across plugins | **Not checked** |
| `TransactionalConnection` rules | Repositories obtained with `ctx` join the request transaction | Always pass `ctx`. Never inject a raw repository | **Not checked** |

**Net result:** nothing in the plan needs a new override of Vendure behaviour. The risky spots are the strategy (do not rely on it), per-tenant payment secrets, and the four existing overrides.

## 3. What changed after the comparison and the new files

### 3.1 Accepted from the comparison

- Keep `BbbOrganizationMember` (trainers, org admins) and `BbbOrganizationMembership` (internal staff). Only `BbbEnrollment` can retire, and only after the consumer audit (C-11). `BbbOrganizationMember` is used by member, session, resolver, channel-access and deletion code.
- The permission is `TenantManageAdmissions`, not BBB-prefixed.
- `LearnerAdmissionPort` sits in the platform layer behind a neutral token. TenantPlugin implements it. The entity stays in TenantPlugin.
- `BbbRoomAccessService` is the single access evaluator. Entitlements are grants, not policy.
- A course enrollment grants access only to resources explicitly linked to the course and eligible under the room-access policy.
- The Users course tool is owned by LearningPlugin. BBB contributes the video-conference tool.
- `channelIdOf(ctx)` and `rawId()` stay as separate helpers.
- Re-admission after LEFT or REVOKED needs an explicit transition, because `create()` returns the existing row unchanged.
- Read the `CustomerSuspensionService` consumers before unifying suspension with membership (N-01).
- LearningPlugin work waits for Phase 0. The BBB sub-module split is not a prerequisite for it.

### 3.2 Corrections to my earlier documents

- **Channel assignment strategy.** I earlier said it might stop learners registering or checking out. The Vendure docs say otherwise, so it is downgraded to verify, test and keep.
- **R4** wrongly proposed retiring `BbbOrganizationMember`. Withdrawn.
- **Permission name** `BBBManageAdmissions` becomes `TenantManageAdmissions`.

* **Hostnames.** I listed wildcard subdomains versus custom domains as an open decision. The code had already retired hosted subdomains, and you have now confirmed custom domains only, so that decision is closed. While checking it I found a domain takeover gap in the custom-domain mapping (N-15).

### 3.3 Review of the learning plugin

The structure is sound: channel columns on every entity, state machines for course, enrollment and announcement, a tool registry that rejects duplicate keys, admission checked on enroll through the port, and tools snapshotted from templates. **It is not safe to register yet.** I could not see `api/api-extensions.ts` (the schema), the admission port and module, or any tests, so those are unreviewed.

| ID | Severity | Finding | Fixed by |
| --- | --- | --- | --- |
| L1 | High | `myCourses` passes `ctx.activeUserId` (a User id) as the customer id, so it never matches the right customer. It also queries enrollment once per course and only sees the first 50 courses | N-02 |
| L2 | High | `suspend`, `complete`, `withdraw` and `isEnrolled` look up the enrollment by course and customer without a channel check. An admin in one tenant can change another tenant's enrollment by guessing the course id | N-03 |
| L3 | High | `addSession` checks the course channel but not that the BBB session belongs to the channel. Once enrollment grants room access, this leaks another tenant's room | N-04 |
| L4 | High | Shop `myCourse` and `courseAnnouncements` require login only. Any authenticated user in the channel reads any published course or announcement without being enrolled | N-05 |
| L5 | High | `isEnrolled` ignores membership. A suspended or revoked academy member keeps course access | N-05 |
| L6 | Medium | `enroll` accepts `courseRole` from input, including TRAINER and ASSISTANT, with only the enroll permission. Trainers are staff, not admitted learners | N-06 |
| L7 | Medium | `input: any` on every mutation. No slug format check, no length limits, no role enum check. `learningCourses` passes `take` through unbounded | N-06 |
| L8 | Medium | `createCourseAnnouncement` does not check the course is in the channel. `publish` can run twice and resets `publishedAt`. No unpublish or delete | N-03 |
| L9 | Medium | The admin API has no operations for sessions, tools or templates. The session service is injected and never used. `getCourseTools` is never exposed | N-08 |
| L10 | Medium | Nothing registers a course tool. New courses get zero tools, so the tools panel would be empty | N-07 |
| L11 | Medium | No deletion handlers for enrollments, announcement authors or created-by ids (INV-013) | N-09 |
| L12 | Medium | `compatibility` is `^3.0.0`. Ids are plain `varchar`. No migration, no tests, no domain document | N-10, C-21 |
| L13 | Low | `canAccess` lets SuperAdmin cross channels. Fine for the platform, but document it and test it | N-03 |
| L14 | Low | Terminal enrollments cannot be re-enrolled, and no history is kept of status changes | D8 |
| L15 | Gap | Nothing links a course to a Vendure product, so a paid course cannot create an enrollment | N-11 |

### 3.4 Review of the Kiro baseline

- **Uncommitted work.** Seven files and one new test are uncommitted, including the strategy registration. Commit them as a checkpoint before anything else (C-00a).
- **Ordering.** The learning plugin exists while C-01 to C-03 are still open, which the plan said to avoid. It is allowed to stay as scaffolding only. It was not in the baseline plugin list. Keep it out of `vendure-config.ts` and generate no migration until Phase 2.
- **Migration state is unknown.** The baseline could not tell which of the five migrations are applied, and `bbb_enrollment` columns may be ahead of tracked code. Check that the database matches the entities before generating anything.
- **Payment exposure.** New tenant channels get the platform Razorpay method, which uses platform credentials. Buyers could pay the platform account. This is the top payment risk (C-05).
- **Inbound and outbound BBB checksums are separate code paths.** No code change is expected (C-07 is a document).
- **Missing documents** the plan expects: known overrides (C-16), checksum audit (C-07), enrollment consumers (C-11), learning domain (C-21).
- **Missing repo.** `edu-frontend` is not in the workspace, which blocks C-29.

## 4. Phase 0: stabilise and close security gaps

Start with C-00a and C-01. Then do the Phase 1 admission tasks (C-02, C-10, C-03) before the rest of this phase, as the Kiro baseline recommends. Each task lists what to touch, how to do it the Vendure-safe way, and when it is done.

### C-00a: Commit the Phase 1a checkpoint

- **Files:** the seven modified files in the baseline (config, tenant plugin, BBB resolver, schema, enrollment entity, order listener, entitlements list) and the new `phase-1a-hotfixes.e2e-spec.ts`.
- **Steps:** run `npm run lint` and the hotfix e2e. Commit as one checkpoint. In a second commit raise TenantPlugin `compatibility` to `^3.7.0`. Then check that the database matches the entities for `bbb_enrollment` (migration `1793511014520` already adds `reason`, `enrolledByUserId`, `enrolledAt`). If `npx vendure migrate --generate` would produce a non-empty migration, delete that file and report it instead of committing it.
- **Done when:** a clean `git status`, lint green, hotfix e2e green.

### C-01: Tenant profile isolation

- **Files:** `tenant-plugin/api/tenant-admin.resolver.ts`, `services/tenant-profile.service.ts`, and the dashboard `shared/academy-dashboard.tsx` and `TenantProfileDetail.tsx`.
- **Steps:**
  1. Write the failing e2e first: a tenant A admin calls `tenantProfile(channelId: B)` and `updateTenantProfile` with B's channel id. Both must fail.
  2. The resolver ignores a client channel id for tenant admins and uses `ctx.channelId`. Only SuperAdmin on the default channel may pass another channel id.
  3. Replace `input: any` with a typed input. Replace `Object.assign(profile, input)` with a whitelist of updatable fields.
  4. Update the dashboard query so it stops sending `channelId`.
- **Vendure note:** these are plugin-owned operations, so no core behaviour changes.
- **Done when:** cross-tenant read and update fail, `test:e2e:tenant` is green, and the Tenant Profile page still loads.

### C-05: Stop the platform Razorpay method reaching tenant channels

- **Files:** `tenant-plugin/services/tenant-registration.service.ts` (`autoProvisionChannelResources`), `payments/` hygiene checker, a new ADR.
- **Steps:**
  1. Failing test: create a tenant channel and query `eligiblePaymentMethods` on its Shop API. The platform Razorpay method must not appear unless that tenant has its own account (N-12).
  2. Stop assigning the platform method to new channels. Extend `PaymentHygieneChecker` to enforce it.
  3. For existing tenant channels, remove the assignment through the Admin API only (confirm the exact mutation by introspection). No database edits.
  4. Write the ADR: platform credentials are never used for tenant sales.
- **Done when:** the test passes and `verify:invariants` passes.

### C-06: Role reconciliation

- **Steps:** run `npm run tenant:roles:check`, then `tenant:roles:repair` if it reports drift. Each later task that adds a permission adds it to `TENANT_ADMIN_ROLE_PERMISSIONS` and re-runs the check. Add a test that the tenant admin role contains `TenantManageAdmissions` once C-02 lands.
- **Done when:** the check reports no drift on dev and the test passes.

### C-07: BBB checksum audit document

- **Output:** `docs/architecture/bbb-checksum-audit.md`. No code change unless live-server evidence requires one.
- **Content:** compare `BbbApiService` with the PHP library for `create`, `join`, `getMeetingInfo`, `end`: checksum is the hash of call name plus query string plus secret, with the algorithm from the plugin option. Record that outbound checksums and inbound webhook verification are separate code paths, and point to the existing known-answer tests.

### C-08: Razorpay webhook negative tests

Add tests (do not rebuild the controller): bad signature, missing event id, duplicate event, persisted but enqueue failed, unknown event, out-of-order event, already-settled payment, provider mismatch.

### C-16: Known Vendure overrides document and guard

- **Output:** `docs/architecture/known-vendure-overrides.md` listing the four overrides with their tenant and SuperAdmin behaviour (INV-016, BUG-025, BUG-026).
- **Tests:** one regression test per override for both caller types. Add a check to `verify:invariants` that builds the Admin schema and fails if a plugin resolver reuses a core query or mutation name that is not on the list.

### N-13: API coverage matrix

- **Output:** `docs/architecture/api-coverage.md`.
- **Steps:** on a dev server (the HardenPlugin turns introspection off in production), `curl` the Admin and Shop endpoints for `__schema`. List every operation per plugin and mark each custom entity as exposed to the Admin API, the Shop API, both or neither. Flag booking, meeting-creation and course-access entities that lack either extension. This is step 1 of your action plan.

### N-01: Suspension source of truth (investigation only)

- **Steps:** read `CustomerSuspensionService` and everything that calls it. Compare `CustomerChannelStatus` with membership SUSPENDED.
- **Output:** a short note with a recommendation for D4. No code change.

### N-14: Custom-domain-only hostname contract

- **Decision:** there are no `*.saa9vi.com` tenant storefronts. Each tenant uses its own domain. `saa9vi.com` serves the marketplace. The admin and API host (`core.saa9vi.com`) is unchanged.
- **State today:** the code already skips the `{tenantSlug}.saa9vi.com` mapping and rejects platform hostnames as custom domains (`tenant-profile-service-no-hosted-subdomain.spec.ts`). What remains is cleanup and the consequences.
- **Steps:**
  1. Remove stale wording: the B-2 comment in the BBB tenant listener that mentions the platform hostname, the `mehta.saa9vi.com` example in `domain-channel.middleware.ts`, and the `registerNewTenant` note that the hostname contract is open. Write the contract in `docs/architecture/hostname-contract.md`: the tenant slug is an internal identifier and never part of a public host.
  2. Add a reserved-hosts list (`saa9vi.com`, `www`, `core`, `marketplace` and every other platform host) that no tenant can map. Extend `rejectPlatformHostname` and its tests. Confirm which host serves the marketplace, because code comments mention both `www.saa9vi.com` and `marketplace.saa9vi.com`.
  3. A tenant without a verified domain has no public storefront. Registration still succeeds. The Overview checklist shows **Connect your domain** (UI-09, UI-13).
  4. Normalise hostnames: lowercase, strip port and trailing dot. Map `www` and the bare domain to the same channel, or require the exact host the tenant uses.
- **Done when:** the tests pass, no code or document describes tenant subdomains as supported, and the hostname contract document is merged.

### N-15: Domain ownership and uniqueness (security)

- **Gap:** `setMapping` writes `channel-token:{customDomain}` to Redis without proof that the tenant owns the domain. In the code I reviewed, the only check is `rejectPlatformHostname`. Correction after reading the repo: the database already enforces a unique custom domain, so one tenant cannot overwrite another's mapping. The remaining risk is squatting: any tenant can claim a domain it does not own, which locks out the real owner.
- **Steps:**
  1. Failing test first: tenant B sets tenant A's domain and is rejected.
  2. The unique index already exists. Normalise the domain (lowercase, no port) before the uniqueness check so two spellings of one domain cannot both be claimed.
  3. Add `customDomainStatus` (PENDING, VERIFIED, FAILED), a verification token and `verifiedAt`. The Redis mapping is written only when the status is VERIFIED.
  4. Verify ownership by a DNS TXT record (`_saa9vi-verify.<domain>` holding the token) and check that the domain points at the platform edge. Add `verifyTenantCustomDomain`, rate-limited, permission `UpdateTenantProfile`.
  5. Changing the domain resets the status to PENDING and removes the old mapping. A tenant can only change the domain of `ctx.channelId` (see C-01).
- **Vendure note:** plugin-owned fields and operations only. No core change.
- **Done when:** takeover test passes, mapping appears only after verification, and verification is shown through `curl` against the Admin API.

### N-16: Routing, TLS and Redis resilience

- **Gap:** production routing through Caddy and TLS is still open (B-5, G10). Redis is the only store the middleware reads. If Redis is empty or unreachable, every request falls through to the default channel, which is the marketplace.
- **Steps:**
  1. TLS: Caddy on-demand TLS with an `ask` endpoint that answers 200 only for VERIFIED domains in the database. Confirm the exact Caddy settings in its docs.
  2. Found in the repo: each mapping expires after 7 days and nothing renews it, so a tenant storefront falls back to the default channel a week after the domain is set. The database is the source of truth. Rebuild the Redis mappings from verified profiles on bootstrap and on a schedule, and write them without an expiry or renew them well before it. Report the count of verified domains against Redis keys in a health check.
  3. For a host that is not a platform host and has no mapping, return a clear 404 instead of serving the default channel. Keep `localhost` and platform hosts passing through.
  4. Tests: a mapped host sets the channel token, an unmapped tenant host gets 404, platform hosts are unchanged, a Redis flush is rebuilt.
- **Vendure note:** Vendure picks the channel from the `vendure-token` header. The middleware sets that header from the hostname, which is how the code works today. Do not change channel resolution inside Vendure. I did not re-check the `apiOptions.middleware` and `channelTokenKey` pages this session.

## 5. Phase 1: identity, access and tenancy

The admission screens for this phase are UI-02 and UI-03 in Phase 3. They can start as soon as C-02 is merged.

### C-02: Admission workflow

- **Files:** `tenant-plugin/services/tenant-learner-membership.service.ts`, a new `admission.service.ts`, a new `TenantLearnerMembershipLog` entity, a new `tenant-admissions.resolver.ts` (keep it out of the large admin resolver), `constants.ts` and the plugin file.
- **Steps:**
  1. New entity `TenantLearnerMembershipLog` (membership, from status, to status, reason, actor user, timestamp), references through `@EntityId()`. Generate the migration with the CLI.
  2. `suspend(reason)` must store the reason in the log. Add an explicit `readmit` transition from LEFT or REVOKED, because `create()` returns the existing row. The target state depends on D2.
  3. `AdmissionService` owns every transition. It validates the allowed-transition table, writes the log row and publishes an event. Nothing else writes membership status.
  4. Permission `TenantManageAdmissions`, registered in the plugin and added to the tenant admin role. Run C-06.
  5. Admin API: `tenantLearnerMemberships(options)` (ListQueryBuilder, filter by status and admission type), `admitTenantLearner`, `activateTenantLearner`, `suspendTenantLearner(reason)`, `revokeTenantLearner(reason)`, `readmitTenantLearner`. The channel comes from `ctx`. The customer must belong to that channel.
- **Tests:** every allowed and forbidden transition, one log row per change, re-admission, cross-tenant attempt, call without the permission.
- **Done when:** all of those pass, and the same operations work through `curl` against the Admin API.

### C-10: LearnerAdmissionPort

- **Check first:** `platform/learner-admission.port.ts` and `learner-admission.module.ts` are imported by the learning plugin but were not in the code I reviewed. Confirm they exist and what they export.
- **Steps:**
  1. Token `LEARNER_ADMISSION_PORT` with `isActiveMember(ctx, customerId, channelId)` and a `getStatus` method. The platform layer must not import any plugin.
  2. TenantPlugin binds the token to `TenantLearnerMembershipService` (`useExisting`).
  3. Replace the string-named `getRepository(ctx, "TenantLearnerMembership")` calls in `bbb-admin.resolver.ts` (`createBbbEnrollment`, `createBbbEntitlement`) with the port.
  4. Test BBB with a fake port that returns false and with one that returns true.
- **Done when:** no plugin reads the membership table by name, and there is no circular module import.

### C-03: Deletion and membership

- **Files:** `tenant-plugin/services/tenant-deletion.service.ts`.
- **Steps:** inject `TenantLearnerMembershipService`. `removeFromChannel` moves the membership to LEFT through `AdmissionService`. `fullDelete` anonymizes and never cascades (INV-013). Never write membership rows directly.
- **Tests:** extend the customer-deletion e2e: membership LEFT after removal, history kept, personal data anonymized.

### C-04: Strategy behavioural tests

- **Steps:** ACTIVE membership means assigned. PENDING, SUSPENDED, REVOKED, LEFT and no membership mean not assigned. Fail closed when there is no connection. Also prove that an unassigned customer can still register and complete checkout, since the strategy does not gate requests.
- **Done when:** these tests run in `test:e2e:tenant`.

### C-11: BbbEnrollment consumers audit

- **Output:** `docs/architecture/bbb-enrollment-consumers.md` listing every reader and writer of `BbbEnrollment` (resolver, room-access policy source `enrollment`, deletion, dashboard Enrollments page). Recommend retirement or keep. Retire nothing in this task.
- **Context:** only `BbbEnrollment` is a retirement candidate. `BbbOrganizationMember` and `BbbOrganizationMembership` stay.

## 6. Phase 2: course domain, BBB link and seller payments

**Do not register `LearningPlugin` in `vendure-config.ts`, and generate no migration for it, until N-02 to N-09 are done.** The scaffold covers C-22 (plugin), C-23 (entities), C-24 (tool registry), C-25 (enrollment), C-26 (agenda, association only) and C-28 (announcements) in part. Each counts as complete only when its N-task below passes.

### C-21: Learning domain document

- **Output:** `docs/architecture/learning-domain.md` with an ownership table. LearningPlugin owns courses, templates, tools, enrollments, announcements and the Users tool. BBB owns sessions and rooms. TenantPlugin owns admission. Record decisions D6 to D10.

### N-02: Fix `myCourses` (L1)

- **Steps:** resolve the Customer from the logged-in user with `CustomerService.findOneByUserId`. Return courses through one joined query on enrollments (status ENROLLED, course PUBLISHED, channel = `ctx.channelId`) with `ListQueryBuilder` paging. No per-course loop.
- **Tests:** a learner sees only their courses. A User id equal to another Customer's id never leaks it.

### N-03: Channel scoping everywhere (L2, L8, L13)

- **Steps:** every enrollment and announcement lookup first loads the course with `channelId = ctx.channelId`. `suspend`, `complete`, `withdraw` and `isEnrolled` go through that check. `createCourseAnnouncement` verifies the course. `publish` is idempotent and keeps the first `publishedAt`. Add `unpublish` and `delete` for drafts. Document and test the SuperAdmin cross-channel path.
- **Tests:** tenant A's admin cannot change tenant B's enrollment, announcement or course by id.

### N-04: Validate session links (L3)

- **Steps:** add a platform port `SESSION_LOOKUP_PORT` (`existsInChannel(ctx, sessionId, channelId)`), implemented by the BBB plugin. `addSession` calls it and rejects foreign sessions. LearningPlugin must not import BBB entities.
- **Tests:** linking a session from another channel fails.

### N-05: Access rules for learners (L4, L5)

- **Steps:** one `CourseAccessService.canView(ctx, courseId, customerId)` that requires an ACTIVE admission (through the port), an ENROLLED enrollment and a PUBLISHED course. Use it in `myCourse`, `courseAnnouncements`, tool listing and later room join. If a public catalogue is wanted, make it a separate query (`courseCatalog`) that returns only listing fields.
- **Tests:** a suspended academy member loses course access. An authenticated non-enrolled user gets nothing.

### N-06: Typed inputs and role control (L6, L7)

- **Steps:** define SDL input types and TypeScript classes for every mutation. Validate slug format, title length and the role enum. Cap list `take` at 100 through `ListQueryBuilder`. Only a caller with `CourseManage.Update` may assign TRAINER or ASSISTANT. Do not let a trainer role be created from a learner admission (D6).

### N-07: Register course tools (L10)

- **Steps:** LearningPlugin registers `users`, `announcements` and `agenda`. BBB registers `videoconference`, in a provider's `onModuleInit`. Route keys stay in trusted code. Test that a duplicate key throws and that a new course gets the default set.

### N-08: Complete the admin API (L9)

- **Steps:** add `courseTools(courseId)`, `updateCourseTool` (visibility and order, validated against the registry), `courseTemplates`, `createCourseTemplateFromCourse`, `courseScheduledSessions`, `addCourseSession`, `removeCourseSession`, and a paged `courseEnrollments`. Review `api-extensions.ts` (not in the code I saw) so every resolver method has a matching SDL field and permission.

### N-09: Deletion handlers (L11)

- **Steps:** register `CourseEnrollment` and announcement authorship with `CustomerDeletionService` (`registerChannelScopedHandler` and `registerFullDeleteHandler`). Anonymize, never cascade (INV-013). Extend the deletion e2e.

### N-10: Ids, compatibility, migration, registration (L12)

- **Steps:** `compatibility: '^3.7.0'`. Convert references to Customer and Channel to `@EntityId()`. If the learning migration has never been applied anywhere, do this before generating it, otherwise add a second migration. Generate with `npx vendure migrate --generate add-learning-plugin`, read it, apply it. Only then register the plugin after BBB and Tenant. Add isolation, lifecycle and deletion e2e specs and a `test:e2e:learning` script.
- **Note:** `jsonb` and `timestamp` columns need PostgreSQL. Confirm the e2e database config uses it.

### C-26: Agenda access through the room policy

- **Steps:** a learner joins a linked BBB session only if `BbbRoomAccessService` allows it. Add a `course` source to the existing INV-027 policy, backed by `CourseAccessService`. Do not create a second evaluator.
- **Tests:** enrolled and admitted can join. Withdrawn, suspended or unlinked cannot.

### N-11: Sell a course (L15)

- **Depends on:** D3.
- **Steps:** `CourseProductLink` (course, product variant, `@EntityId()`) in LearningPlugin. An `OrderStateTransitionEvent` listener creates the enrollment, idempotently, after checking the order channel equals the course channel (same guard as the BBB listener). No custom order states.

### N-12: Per-tenant payment account

- **Output:** `TenantPaymentAccount` (channel, provider, mode, key id, encrypted secret reference, webhook key, status). Secrets are encrypted at rest, never returned by any API, and never placed in `PaymentMethod` handler args.
- **Steps:** create one channel-aware `PaymentMethod` per tenant when its account is ACTIVE. The handler picks credentials by `ctx.channelId`. Keep the single webhook endpoint and add a non-secret `webhookKey` path segment so the right tenant secret is selected before the raw-body signature check. Reuse `PaymentWebhookEvent`. Offline payments use Vendure's manual payment mutation (confirm name and permission).
- **Tests:** two tenants, two accounts, a payment on tenant A is verified with A's secret only. A tenant with no account has no eligible payment method.

## 7. Phase 3: admin UI/UX and storefront

### 7.1 Admin UI today

| Area | Pages that exist | Missing |
| --- | --- | --- |
| Academy Console (TenantPlugin) | Overview, Tenant Profile, Instructors, Media Library | Learners (admissions), Payments |
| BigBlueButton | Dashboard, Rooms, Meetings, Sessions, People, Members, Enrollments, Entitlements, Billing, Plans, Servers, Trials, Organizations, Memberships | Admission awareness (no screen shows or enforces membership) |
| Courses | Nothing | Course list, course detail, templates |
| CMS, Marketplace, Reviews, Subscription, Platform | Articles, pages, banners; campaigns, wallet; reviews; mandates, attempts, reconciliation; login branding | Nothing for this scope |

### 7.2 Conventions for every new page

- Use `defineDashboardExtension` with a `navSections` entry and `routes`, in a `dashboard/index.tsx` that the plugin points to. Copy the pattern in the Tenant and BBB plugins. Edit no core dashboard page.
- Use components from `@vendure/dashboard` and typed `graphql` documents from `@/gql`. Run the project's codegen after changing a query.
- Set `requiresPermission` on every nav item and hide actions the user cannot run.
- Every page has loading, empty and error states. Reuse the subscription plugin's `query-state-panel`.
- Lists page with `take` and `skip`, filter, sort and search. Destructive actions use a confirm dialog and ask for a reason when the API takes one.
- Show dates in `Asia/Kolkata` and money in INR. Use plain, short labels.
- Each page passes the `DashboardGraphqlContractChecker` in `verify:invariants` and the dashboard type-check.

### 7.3 Admin UI tasks

#### UI-01: Tenant Profile follows C-01

- **Depends on:** C-01. Stop sending `channelId`. Show a field-level error when the API rejects an update. Add a visible onboarding-complete state.

#### UI-02: Learners (admissions) page

- **Where:** Academy Console, new item **Learners**. **Permission:** `TenantManageAdmissions`. **Depends on:** C-02.
- **Contents:**
  - Table: name, email, phone, status badge, admission type, admitted on, last activity. Filters: status and admission type. Search by name, email or phone.
  - **Admit learner** dialog: pick an existing customer or enter an email to invite, choose admission type, optional reason.
  - Row actions that match the state machine only: Activate, Suspend, Revoke, Re-admit. Suspend and Revoke require a reason.
  - A history drawer from `TenantLearnerMembershipLog`.
  - Later: CSV import and export.
- **Done when:** a tenant admin runs the whole lifecycle from the UI, and a user without the permission sees no menu item.

#### UI-03: Learner detail

- **Tabs:** Profile, Admission history, Courses, Rooms and entitlements, Orders. Link to it from the BBB People list and from Learners. Shows why a learner can or cannot join a room, using the room-access policy result.

#### UI-04: BBB screens become admission-aware

- **Depends on:** C-02, C-10. On Entitlements and Enrollments, show admission status next to each person. Disable the Add action and explain why when the customer is not ACTIVE. Map the `ForbiddenError` to a readable message. Mark the Enrollments page as legacy until C-11 decides its future.

#### UI-05: Courses list

- **Where:** new nav section **Courses**. **Permission:** `CourseManage`. **Depends on:** N-08, N-10.
- **Contents:** status tabs (Draft, Published, Closed, Archived), search, **New course** dialog (title, slug suggested from title, template). Row actions follow the state machine: Publish, Close, Archive (Archive only for SuperAdmin).

#### UI-06: Course detail

- **Tabs:**
  - **Overview:** edit title and description, see status and dates.
  - **Tools:** three groups (Authoring, Interaction, Administration) from the registry, each with a visibility toggle and drag order.
  - **Users:** enrollments with status and role. Enroll dialog lists only ACTIVE admitted learners. Suspend, Complete, Withdraw actions. Role selector only for users with `CourseManage.Update`.
  - **Agenda:** linked BBB sessions with time and status, Add and Remove, plus a shortcut to schedule a new session in the BBB screens.
  - **Announcements:** draft, preview, publish, unpublish, delete draft.

#### UI-07: Course templates

- List templates (platform defaults and the tenant's own), view their tools, **Create template from this course**, and set a default (D7).

#### UI-08: Payments settings

- **Where:** Academy Console, new item **Payments**. **Depends on:** N-12, D11.
- **Contents:** account status badge, test or live mode, a connect form that never displays stored secrets after saving, webhook health from recent `PaymentWebhookEvent` rows, a plain statement that Saa9vi never holds the tenant's funds. On an order, an action to record an offline payment through the manual payment mutation.

#### UI-09: Onboarding checklist on Overview

- Steps with live status: profile complete, domain verified, first instructor, payment account connected, first course published, first learner admitted, first session scheduled. Each step links to its page.

#### UI-10: Remove from academy on the customer page

- Add an action to the Vendure customer detail page (through the dashboard extension action bar) that moves the learner to LEFT with a reason. Explain in the dialog that history is kept and personal data is anonymized, not deleted (INV-013).

#### UI-11: Platform (SuperAdmin) views (optional, last)

- Tenants list with channel suspension state, payment account status and admission counts. Only if the platform team asks for it.

#### UI-12: UI tests and checks

- Add a GraphQL contract spec per new page (the subscription plugin's `dashboard-graphql-contract.spec.ts` is the model). Keep the dashboard type-check ratchet green. For each page record a short manual smoke checklist and a screenshot in the progress log.

#### UI-13: Domain settings

- **Where:** Academy Console, new item **Domain** (or a section on Tenant Profile). **Permission:** `UpdateTenantProfile`. **Depends on:** N-15.
- **Contents:** domain field with inline validation (platform hosts rejected with a plain message), the DNS record to add (name and value, copy buttons), status badge (Pending, Verified, Failed), **Check now** button with last-checked time and the reason for a failure, and a warning that changing the domain takes the old storefront offline.
- **Done when:** a tenant admin can add a domain, follow the instructions and see it reach Verified without help.

### 7.4 Storefront (Next.js `edu-frontend`)

The repository is not in the workspace. **C-29 is blocked until it is attached.** All calls go to the Shop API.

- **C-29: Audit and typed client.** Compare the app's queries with the current Shop schema. Generate a typed client from the Shop schema. List every query that no longer exists.
- **F-01: My courses.** Uses `myCourses` and `myCourse(slug)`. Course page shows tools, announcements and agenda.
- **F-02: Invite and admission states.** Pages for invite accepted, awaiting approval and suspended, each with a clear next step.
- **F-03: Razorpay checkout.** Add the payment through the Vendure `addPaymentToOrder` flow with the Razorpay handler, open Razorpay Checkout in the browser, then poll the order until the webhook has settled it. Handle failed, cancelled and pending payments.
- **F-04: Join meeting after payment.** Once the order is fulfilled and access exists, show **Join** on the session. Handle not started, ended and server busy states with plain messages.
- **F-05: Error mapping.** Turn `ForbiddenError` and illegal-operation errors into learner-friendly messages.

* **F-06: Host-based tenant resolution.** One multi-tenant Next.js deployment serves every tenant domain. Middleware reads the request host, finds the channel token (same mapping as the API, or a small internal lookup), and sends it with every Shop API call. Unknown hosts get a "storefront not available" page. `saa9vi.com` pages use the default channel for the marketplace. Canonical URLs use the tenant's domain, and cache keys include the host so tenants never share cached pages.

## 8. Order of work, definition of done and open decisions

### 8.1 Order of work

1. C-00a, then C-01 (with UI-01), then N-15 (domain takeover fix).
2. C-02, C-10, C-03, C-04 (admission). UI-02 and UI-03 start after C-02.
3. C-05, C-06, C-07, C-08, C-16, N-13, N-01, C-11, N-14, N-16 (these can run in parallel with step 2).
4. C-21, then N-02 to N-09 and N-10, then register `LearningPlugin`. N-07 and N-08 unblock UI-05 to UI-07.
5. C-26, N-11, N-12 and UI-08.
6. UI-04, UI-09, UI-10, UI-12.
7. Storefront: C-29 first (needs the repo), then F-01 to F-05.

### 8.2 Definition of done (every task)

- Failing test written first, now passing. For tenant-scoped work, the cross-tenant case is included.
- `npm run lint`, the relevant e2e script and `npm run verify:invariants` are green.
- Schema change: one migration from `npx vendure migrate --generate`, reviewed, schema-only, applied through the CLI. No manual database edits.
- Data changes shown only through GraphQL `curl` calls, with request and response in the progress log.
- No new resolver reuses a core operation name. No second payment handler, webhook inbox, access evaluator or deletion orchestrator.
- New permissions are registered, added to the tenant admin role, and `tenant:roles:check` is clean.
- New dashboard pages have nav permissions, loading, empty and error states, and pass the GraphQL contract check.
- Any Vendure behaviour marked **Not checked** in section 2 is confirmed on docs.vendure.io before use, and the result is noted in the progress log.

### 8.3 Open decisions (need your answer)

**Decided, no longer open:** tenant hostnames (formerly D1). Tenants run their storefront only on their own domain. There are no `*.saa9vi.com` tenant subdomains. The parent domain `saa9vi.com` serves the marketplace. The follow-up work is N-14 to N-16, UI-13 and F-06.

| ID | Question | Blocks |
| --- | --- | --- |
| D2 | Registration: open, or approval needed? This also sets the state a re-admitted learner returns to | C-02, UI-02 |
| D3 | Does a paid order create an admission, or only an enrollment for an already admitted learner? | N-11 |
| D4 | One source of truth for suspension: membership, or `CustomerChannelStatus`? | N-01 outcome |
| D5 | Minors and DPDP consent handling for learners | Admission form, deletion rules |
| D6 | Course trainers: staff accounts (BBB organization members) or a role on the enrollment? | N-06, UI-06 |
| D7 | Default course template: platform default only, or each tenant can set its own? | UI-07 |
| D8 | Can a withdrawn or completed learner re-enroll? Do you want an enrollment history table? | N-03 |
| D9 | Do published announcements send email or push, or only show in the app? | N-03, UI-06 |
| D10 | What happens to enrolled learners when a course is CLOSED or ARCHIVED? | N-05 |
| D11 | Does each tenant bring its own Razorpay keys? (assumed yes, since Saa9vi never holds seller payments) | N-12, UI-08 |

### 8.4 What I could not review

The learning plugin's `api/api-extensions.ts` (GraphQL schema), the `learner-admission` port and module, and any tests were not in the files I received. The Vendure docs fetch limit was reached part way through, so the items marked **Not checked** in section 2 rest on repo patterns, not on the docs.
