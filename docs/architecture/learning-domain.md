# Learning Domain Mini-Spec (C-21)

**Date:** 1 November 2026  
**Status:** DESIGN — for owner review before implementation.  
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
| `createdByUserId` | varchar | Actor |
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

Unique index: `(channelId, name)` where channelId may be null (platform default).

### CourseTemplateTool
Ordered tool defaults for a template.

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `templateId` | FK → CourseTemplate | |
| `toolKey` | varchar | Registry key (e.g. `videoconference`, `agenda`, `users`) |
| `order` | int | Display order |
| `visibility` | varchar | `VISIBLE` / `HIDDEN` |
| `settings` | jsonb, nullable | Validated by tool registry |

### CourseTool
Per-course snapshot of template tools. **Snapshot, not reference** — template edits do not mutate existing courses.

| Column | Type | Notes |
|---|---|---|
| `id` | auto PK | |
| `courseId` | FK → LearningCourse | |
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
| `courseId` | FK → LearningCourse | |
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
| `courseId` | FK → LearningCourse | |
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
INVITED → ENROLLED → COMPLETED
                ↘ SUSPENDED → ENROLLED (re-activate)
                ↘ WITHDRAWN (terminal)
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
| `CourseAnnouncementManage` | Academy staff: create/edit/publish announcements |

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
| Admin API | Academy staff | Create/edit/publish/close course, manage enrollments, manage announcements, manage tools |
| Shop API | Enrolled learner | View course, view tools, view agenda, join videoconference, view announcements |
| Shop API | Authenticated customer | List available courses (if published), accept invitation |

---

## 7. Invariants

1. Course enrollment requires ACTIVE academy admission (`LearnerAdmissionPort`).
2. Course TRAINER does not auto-grant BBB moderator (D8).
3. Course tools are snapshots — template edits do not mutate existing courses.
4. Cross-tenant course access is denied at the service level.
5. Hidden tools are not rendered, but their API endpoints still enforce authorization.
6. `myLearningDashboard` semantics are preserved — LearningPlugin does not replace the existing BBB entitlement/session projection.
