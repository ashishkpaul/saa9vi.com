# ADR-053 — LearningPlugin: Course Domain Design

**Status:** ACCEPTED  
**Date:** 16 November 2026  
**Author:** Kiro CLI baseline (C-22 through C-28)

---

## Context

Saa9vi requires a Chamilo-inspired course management layer sitting above the BigBlueButton live-class infrastructure. The course is the commercial unit tenants sell; the BBB scheduled session is the delivery mechanism within it. The two domains must remain loosely coupled: a course can carry tools beyond BBB (video, documents, quizzes), and BBB sessions can exist without a parent course.

Three design questions required explicit decisions before code was written:

1. **Scoping** — do `LearningCourse` and its subordinate entities follow the same channel-scoping rules as other tenant entities (INV-001)?
2. **Admission gate** — should course enrollment check the learner's academy admission status, and how is that check wired without coupling `LearningPlugin` to `TenantPlugin`?
3. **Tool extensibility** — how are non-BBB course tools registered so that plugins can contribute tools without tight coupling?

---

## Decisions

### D1 — `LearningCourse` uses scalar `channelId` (not full `ChannelAware`)

`LearningCourse`, `CourseEnrollment`, `CourseScheduledSession`, and `CourseAnnouncement` carry a scalar `channelId` column. All queries include an explicit `channelId` WHERE clause scoped to `ctx.channelId`. Full `ChannelAware` (join table + `assignToCurrentChannel`) is not used.

**Rationale:** Consistent with the precedents for `InstructorProfile` (ADR-010), `BbbEntitlement` (ADR-011), and `BbbOrganizationMembership` (ADR-017). The access pattern is always a direct filter by channel; the join-table overhead adds no channel-safety benefit because all queries are code-verified. `LearningCourseService.canAccess()` enforces the channel boundary for every read and mutation.

**Consequences:**

- Every service method that reads or mutates a `LearningCourse` must include `channelId: String(ctx.channelId)` in the WHERE predicate, or call `canAccess()` after fetch.
- `CourseEnrollment` carries both a scalar `courseId` identifier and a redundant `channelId` column so that cross-channel enrollment isolation is enforced at the enrollment row level, not only by checking the parent course. The entity currently declares no TypeORM relation/foreign-key decorator for `courseId`. This is the N-03 L2 fix.
- `CourseTemplate` is an exception: it carries a nullable `channelId` to support platform-default templates (`channelId IS NULL`) shared across all tenants. A template whose `channelId` is non-null must match the calling channel.

---

### D2 — Academy admission gate uses an injected port (`LearnerAdmissionPort`), not a direct `TenantPlugin` import

`CourseEnrollmentService` requires that a learner hold `TenantLearnerMembership.status = ACTIVE` before enrolling in a course. The check is expressed as an interface (`LearnerAdmissionPort`) resolved at runtime from a NestJS injection token (`LEARNER_ADMISSION_PORT`). `LearningPlugin` imports `LearnerAdmissionModule` (a platform-level NestJS module), not the `TenantPlugin` class directly. The platform module registers `TenantLearnerMembershipService` as the provider for the token; TenantPlugin also exports the same service/token binding for other consumers.

**Rationale:** A direct import of `TenantPlugin` services into `LearningPlugin` would create a plugin-to-plugin dependency that couples deployment order, circular injection risk, and test surface. The port pattern (a named injection token bound to a concrete implementation by the platform wiring layer) keeps `LearningPlugin` testable in isolation by substituting a stub and keeps the two plugins independently versioned.

**Consequences:**

- `LearnerAdmissionModule` (`src/platform/learner-admission.module.ts`) owns the token binding and injects `TenantLearnerMembershipService` as the implementation.
- `LearningPlugin` lists `LearnerAdmissionModule` in its `imports` array.
- Tests that need to override the admission check inject a stub via `{ provide: LEARNER_ADMISSION_PORT, useValue: { isActiveMember: async () => true } }`.
- This pattern is the reference for any future cross-plugin behavioral dependency in Saa9vi — prefer a platform port over a direct plugin import.

---

### D3 — Course tools use a registry contributed at bootstrap (`CourseToolRegistry`), not a polymorphic entity hierarchy

The set of tools a course can carry (BBB sessions, video content, documents, quizzes) is registered at application startup via `CourseToolContributor` implementations. `CourseTool` rows store a stable `toolKey` string referencing a registered definition. Tools are not represented as a TypeScript class hierarchy or a discriminated-union entity table.

**Rationale:** A polymorphic entity hierarchy (one table per tool type) would require a migration every time a new tool type is introduced. A registry avoids that schema rigidity while still providing type-safe tool metadata at runtime. The `toolKey` is the stable identifier; tool settings are stored as a JSON column (`settings`) and optional definition validators are applied by `CourseToolRegistry.validateTools()` when template tools are snapshotted. The current `updateCourseTool` mutation changes only visibility/order and confirms the stored key is still registered.

**Alternatives rejected:**

- Per-tool entity tables (migration required per new tool type).
- Storing tool type logic in `CourseTool` discriminator column (couples schema to implementation).

**Consequences:**

- `LearningToolContributor` registers the built-in `description`, `users`, `agenda`, and `announcements` tools. `BbbVideoconferenceToolContributor` in BigBlueButtonPlugin registers the `videoconference` key at bootstrap.
- `CourseToolRegistry.validateTools()` is called on template snapshot and direct tool mutation to prevent unknown tool keys from reaching the database.
- Adding a new tool type requires: (a) a new `CourseToolContributor` implementation in the contributing plugin, (b) a new tool key string — no schema change.

---

### D4 — `CourseEnrollment` status is a FSM with explicit allowed transitions; terminal states require a service-layer re-enroll operation

`CourseEnrollment.status` follows a strict FSM:

```
INVITED → ENROLLED
   └──→ WITHDRAWN  (terminal)

ENROLLED → SUSPENDED → ENROLLED
         → COMPLETED  (terminal)
         → WITHDRAWN  (terminal)

SUSPENDED → ENROLLED
          → COMPLETED  (terminal)
          → WITHDRAWN  (terminal)
```

Re-enrollment from `COMPLETED` or `WITHDRAWN` is not supported by the current transition table; a new enrollment row is required (not yet implemented). `SUSPENDED → ENROLLED` re-activation is supported.

**Rationale:** Mirrors the `TenantLearnerMembership` FSM pattern (ADR-052). Explicit transition tables prevent accidental status drift and make the access logic predictable. Terminal states that cannot be escaped without a fresh row are a deliberate safety guard: a completed or withdrawn learner must go through an explicit re-enrollment path rather than a silent status reset.

**Consequences:**

- `CourseEnrollmentService.transition()` validates the target state against the allowed transitions table before writing.
- Clients that attempt an illegal transition receive `IllegalOperationError`, not a silent no-op.
- Re-enrollment from terminal states is a documented gap (pending product decision on whether a completed learner can re-take a course).

---

## Related

- `src/plugins/learning-plugin/` — all LearningPlugin entities and services
- `src/platform/learner-admission.port.ts` — `LearnerAdmissionPort` interface and token
- `src/platform/learner-admission.module.ts` — port binding
- `src/platform/course-tool-registry.module.ts` — `CourseToolRegistry` module
- `src/platform/course-permissions.ts` — `courseManagePermission`, `courseEnrollPermission`, `courseAnnouncementPermission`
- ADR-010, ADR-011, ADR-017 — scalar `channelId` precedents
- ADR-052 — `TenantLearnerMembership` FSM and suspension semantics
- INV-001 — Channel = Tenant (applies to all `LearningPlugin` entities via scalar `channelId`)


---

## As-built implementation notes — 16 November 2026

The accepted design is implemented as a backend plugin, but the currently exposed API is narrower than the full course-platform concept:

- Admin API: `learningCourses`, `learningCourse`, `courseEnrollments`, `courseAnnouncements`, `courseTools`, `courseScheduledSessions`, and `courseToolDefinitions`; mutations cover course create/update/publish/close/archive, learner enroll/suspend/complete/withdraw, announcement create/update/publish, tool visibility/order updates, and course-to-BBB-session linking.
- Shop API: `myCoursePages`, `myCoursePage(slug)`, and `coursePageAnnouncements(courseId)`. These reads require an authenticated customer, an `ENROLLED` course enrollment, a `PUBLISHED` course, and active academy admission. Hidden tools are filtered from Shop results.
- There is no Shop API enrollment/invitation-acceptance mutation. The current `enrollLearner` Admin mutation creates an `ENROLLED` row directly; the `INVITED` state is represented in the entity/FSM but no invitation-creation or acceptance operation is exposed.
- Template entities and template snapshotting exist, but the current GraphQL extension does not expose template CRUD. `createLearningCourse` can accept a `templateId`.
- Course-to-session links store identifiers and tenant channel scope; the entities use scalar identifier columns rather than TypeORM relation decorators.
- The tool registry keys currently include `description`, `users`, `agenda`, `announcements`, and `videoconference` (contributed by BigBlueButtonPlugin). The BBB tool is a UI/tool declaration only; actual room access remains governed by BBB authorization (INV-027).

The FSM implemented in `CourseEnrollmentService` also permits `SUSPENDED → COMPLETED` and `INVITED → WITHDRAWN`; `COMPLETED` and `WITHDRAWN` remain terminal. Re-enrolling from a terminal row is rejected.

**Verification boundary:** this is a source/SDL review at commit `3c245952d57b9ddeb27b9cbd6ee01de5bae0ba71`; it is not evidence of storefront integration or live production behavior.
