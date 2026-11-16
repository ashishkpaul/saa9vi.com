# Learning Domain Mini-Spec (C-21; as-built reconciliation)

**Date:** 16 November 2026  
**Status:** Backend implementation present (C-22 through C-28). Shop enrollment, invitation workflow, template CRUD and storefront integration remain outside the current exposed API.  
**Plugin:** `LearningPlugin` (new, `src/plugins/learning-plugin/`)

---

## 1. Entities

### LearningCourse
Tenant-owned course identity. Scalar `channelId` with explicit service-level assertions (not ChannelAware — same pattern as `BbbEntitlement`).

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `channelId` | varchar | Tenant boundary |
| `slug` | varchar | Unique per channel: `(channelId, slug)` unique index |
| `title` | varchar | |
| `description` | text, nullable | |
| `status` | varchar | `DRAFT` / `PUBLISHED` / `CLOSED` / `ARCHIVED` |
| `templateId` | varchar, nullable | Snapshot source template |
| `createdByUserId` | varchar, nullable | Actor |
| `createdAt` / `updatedAt` | timestamp | |

### CourseTemplate
Platform-default or tenant-specific reusable configuration.

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `channelId` | varchar, nullable | null = platform default |
| `name` | varchar | |
| `description` | text, nullable | |
| `isDefault` | boolean | One platform default |

Current source declares a non-unique index on `(channelId, name)`. It does not enforce uniqueness or guarantee a single platform-default template.

### CourseTemplateTool
Ordered tool defaults for a template.

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `templateId` | varchar | Scalar template identifier; no TypeORM relation decorator |
| `toolKey` | varchar | Registry key (e.g. `videoconference`, `agenda`, `users`) |
| `order` | int | Display order |
| `visibility` | varchar | `VISIBLE` / `HIDDEN` |
| `settings` | jsonb, nullable | Validated by tool registry |

### CourseTool
Per-course snapshot of template tools. **Snapshot, not reference** — template edits do not mutate existing courses.

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `courseId` | varchar | Scalar course identifier; no TypeORM relation decorator |
| `toolKey` | varchar | |
| `order` | int | |
| `visibility` | varchar | `VISIBLE` / `HIDDEN` |
| `settings` | jsonb, nullable | |

Unique index: `(courseId, toolKey)`.

### CourseEnrollment
Customer/course relationship.

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `courseId` | varchar | Scalar course identifier; no TypeORM relation decorator |
| `customerId` | varchar | Vendure Customer.id |
| `channelId` | varchar | Denormalized for scoping |
| `courseRole` | varchar | `LEARNER` / `TRAINER` / `ASSISTANT` |
| `status` | varchar | `INVITED` / `ENROLLED` / `SUSPENDED` / `COMPLETED` / `WITHDRAWN` |
| `invitedByUserId` | varchar, nullable | |
| `enrolledAt` | timestamp, nullable | |
| `createdAt` / `updatedAt` | timestamp | |

Unique index: `(courseId, customerId)` — one enrollment per course per customer (D5: one primary role).

### CourseScheduledSession
Join entity linking courses to existing BBB scheduled sessions (D4 Option B).

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `courseId` | varchar | Scalar course identifier; no TypeORM relation decorator |
| `sessionId` | varchar | BbbScheduledSession.id |
| `channelId` | varchar | Denormalized for scoping |

Unique index: `(courseId, sessionId)`. A session MAY belong to multiple courses (D4: many-to-many allowed).

### CourseAnnouncement
Course-scoped announcements (MVP D10).

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `courseId` | FK → LearningCourse | |
| `channelId` | varchar | Denormalized |
| `title` | varchar | |
| `body` | text | |
| `status` | varchar | `DRAFT` / `PUBLISHED` |
| `publishedAt` | timestamp, nullable | |
| `authorId` | varchar | |
| `createdAt` / `updatedAt` | timestamp | |

---

## 2. State machines

### LearningCourse lifecycle

```
DRAFT → PUBLISHED → CLOSED → ARCHIVED
```

- `DRAFT`: Only academy staff can see/edit. No Shop API exposure.
- `PUBLISHED`: Visible to enrolled learners via Shop API. Enrollment open.
- `CLOSED`: No new enrollments. Existing enrollments remain accessible.
- `ARCHIVED`: Read-only. No mutations. Existing enrollments preserved.

Who may publish/close: academy staff with `TenantManageAdmissions` or a dedicated course permission.
Who may archive: SuperAdmin only.

### CourseEnrollment lifecycle

```
INVITED → ENROLLED | WITHDRAWN
ENROLLED → SUSPENDED | COMPLETED | WITHDRAWN
SUSPENDED → ENROLLED | COMPLETED | WITHDRAWN
COMPLETED → terminal
WITHDRAWN → terminal
```

- `INVITED`: Invitation sent, not yet accepted.
- `ENROLLED`: Active participation.
- `SUSPENDED`: Temporary block (academy staff). Re-activatable.
- `COMPLETED`: Terminal — finished the course.
- `WITHDRAWN`: Terminal — learner left or was removed.

---

## 3. Cardinality decisions

| Decision | Choice | Rationale |
|---|---|---|
| D4 — Session↔Course | Many-to-many | One BBB session can appear in multiple courses; one course has many sessions |
| D5 — Course roles | One role per enrollment | If multi-role needed later, use separate assignment table |
| D6 — Templates | Platform default + tenant override; snapshot on create | Existing courses unaffected by template edits |
| D8 — Trainer→BBB | Explicit mapping required | Course TRAINER does NOT auto-imply BBB moderator |

---

## 4. Permissions

| Permission | Scope |
|---|---|
| `CourseManage` (CRUD) | Academy staff: create/edit/publish/close courses |
| `CourseEnroll` | Academy staff: enroll/suspend/withdraw learners |
| `CourseAnnouncement` | Academy staff: create/edit/publish announcements |

All course permissions are channel-scoped. SuperAdmin bypasses. Course operations check `LearnerAdmissionPort.isActiveMember()` for enrollment eligibility (ACTIVE academy admission required).

---

## 5. Tool registry

MVP tools (D10):
- `description` — Course description (AUTHORING)
- `users` — Roster (ADMINISTRATION)
- `agenda` — Schedule/BBB sessions (INTERACTION)
- `announcements` — Course announcements (INTERACTION)
- `videoconference` — BBB adapter (INTERACTION)

Registry is a typed provider map. BBB plugin contributes the `videoconference` tool definition via a port. Routes and component mappings live in trusted code only — tenant settings cannot define arbitrary routes.

---

## 6. GraphQL actors

| API | Actor | Operations |
|---|---|---|
| Admin API | Academy staff | Create/edit/publish/close/archive course, enroll/suspend/complete/withdraw learners, manage announcements and tool visibility/order, link/unlink BBB sessions |
| Shop API | Enrolled learner | `myCoursePages`, `myCoursePage(slug)`, `coursePageAnnouncements(courseId)`; visible course tools are resolved by `CoursePageFieldResolver` |


---

## 7. Invariants

1. Course enrollment requires ACTIVE academy admission (`LearnerAdmissionPort`).
2. Course TRAINER does not auto-grant BBB moderator (D8).
3. Course tools are snapshots — template edits do not mutate existing courses.
4. Cross-tenant course access is denied at the service level.
5. Hidden tools are not rendered, but their API endpoints still enforce authorization.
6. `myLearningDashboard` semantics are preserved — LearningPlugin does not replace the existing BBB entitlement/session projection.


---

## 8. As-built GraphQL and workflow boundary (16 November 2026)

### Admin API

The current SDL exposes these query fields:

- `learningCourses`, `learningCourse`
- `courseEnrollments`, `courseAnnouncements`, `courseTools`, `courseScheduledSessions`
- `courseToolDefinitions`

The mutations are:

- `createLearningCourse`, `updateLearningCourse`, `publishLearningCourse`, `closeLearningCourse`, `archiveLearningCourse`
- `enrollLearner`, `suspendLearner`, `completeLearner`, `withdrawLearner`
- `createCourseAnnouncement`, `publishCourseAnnouncement`, `updateCourseAnnouncement`
- `updateCourseTool`, `addCourseSession`, `removeCourseSession`

There are no template CRUD fields, no invitation-creation operation and no Shop enrollment/accept-invitation mutation. A template may be supplied by ID during course creation; template tools are copied into CourseTool rows. Without a template, the registry's current definitions seed the new course.

### Shop API access rule

`myCoursePages`, `myCoursePage(slug)` and `coursePageAnnouncements(courseId)` resolve the logged-in User to a Vendure Customer, then require:

1. the course is in the active channel and `PUBLISHED`;
2. the customer has an `ENROLLED` CourseEnrollment in that channel; and
3. the customer has an `ACTIVE` TenantLearnerMembership, checked through `LearnerAdmissionPort`.

The Shop field resolver returns only tools with `visibility = VISIBLE`. Tool visibility is not an authorization grant to join BBB; room/session access remains in BigBlueButtonPlugin.

### As-built entity/index notes

- Entity references such as `templateId`, `courseId` and `sessionId` are scalar string columns in the current entity definitions. The current TypeORM entities do not declare relations/foreign keys for these references.
- `CourseTemplate` has a non-unique `(channelId, name)` index; the model does not enforce exactly one platform-default row.
- `CourseEnrollment` has a unique `(courseId, customerId)` index and a redundant `channelId` column for tenant-scope assertions.
- The implemented enrollment transition table additionally permits `INVITED → WITHDRAWN` and `SUSPENDED → COMPLETED`. `enrollLearner` writes `ENROLLED` directly; the `INVITED` state is not currently driven by a public invitation workflow.

**Review baseline:** source and SDL at commit `3c245952d57b9ddeb27b9cbd6ee01de5bae0ba71`; no build, migration or live storefront verification is claimed.
