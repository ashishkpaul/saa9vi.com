# Phase 0 — API Alignment + INV-008 Audit

> **Status:** ✅ Complete
> **Date:** 2026-01-08

---

## 1. Fragments

| Fragment | Status | Action |
|---|---|---|
| `CmsArticleFragment` | ✅ Exists | No change needed |
| `ReviewFragment` | ✅ Exists | No change needed |
| `SessionCardFragment` | ✅ Exists | No change needed |
| `InstructorCardFragment` | ✅ Exists | No change needed |
| `TenantProfileFragment` | ✅ Exists | No change needed |

**Result:** All required fragments present. No new fragments needed.

---

## 2. INV-008 Exception — `session-cta.ts`

**File:** `src/lib/vendure/session-cta.ts`

**Finding:** Contains `getSessionCta()` — client-side entitlement isolation layer that:
- Determines CTA label/action based on `joinUrl`, `isTrial`, `trial.status`
- Should live server-side as `courseAccess(courseId)` per ADR-013 INV-006/INV-008
- File header contains explicit TODO documenting this exception

**Action taken:**
- Documented in `known-bugs.md` as active bug INV-008
- Phase 1 constrained: `session-cta.ts` stays frozen, no new logic added
- Phase 1 implements presentational helpers only (timestamp formatting, status badges)

---

## 3. New Mutation Error Handling Audit

**Mutations audited:**
- `registerForTrial` (bbb-shop.resolver.ts:483)
- `bbbJoinRoom` (bbb-shop.resolver.ts:214)
- `startScheduledSession` (bbb-shop.resolver.ts:530)
- `submitProductReview` (product-review-shop.resolver.ts:148)
- `voteOnReview` (product-review-shop.resolver.ts:200)
- `reportReview` (product-review-shop.resolver.ts:277)
- `leaveAcademy` (bbb-shop.resolver.ts:605)
- `deleteMyAccount` (bbb-shop.resolver.ts:621)

**Findings:**

| Mutation | Returns ErrorResult? | Notes |
|---|---|---|
| `registerForTrial` | ❌ No | Returns typed object; errors thrown as exceptions |
| `bbbJoinRoom` | ❌ No | Returns typed object; errors thrown as exceptions |
| `startScheduledSession` | ❌ No | Returns typed object; errors thrown as exceptions |
| `submitProductReview` | ❌ No | Returns service result directly |
| `voteOnReview` | ❌ No | Throws `UserInputError` on auth/not-found |
| `reportReview` | ❌ No | Throws `UserInputError` on auth |
| `leaveAcademy` | ❌ No | Returns `{success, message}` |
| `deleteMyAccount` | ❌ No | Returns `{success, message}` |

**Existing commerce mutations follow the pattern:**
- `LoginMutation`, `AddToCartMutation`, `ApplyPromotionCodeMutation` all use `__typename` + `... on ErrorResult` union

**Recommendation:** New mutations should adopt `ErrorResult` union pattern for Phase 2–5 implementation.

**Frontend mutations (mutations.ts):**
- `RegisterForTrialMutation` — no ErrorResult fragment
- `BbbJoinRoomMutation` — no ErrorResult fragment
- `StartScheduledSessionMutation` — no ErrorResult fragment
- `SubmitProductReviewMutation` — no ErrorResult fragment
- `VoteOnReviewMutation` — no ErrorResult fragment

**Action:** Phase 2–5 to add `__typename` + `ErrorResult` fragments to all new mutations.

---

## 4. Cache Strategy Confirmation

**Current pattern (Next.js 16):**
- `'use cache'` directive in page components
- `getActiveChannelCached()` for channel resolution inside cached scopes
- `channelToken` passed explicitly to `query()`/`mutate()` to avoid `next/headers()` in cache scope
- Page-level channel resolution via `getActiveChannel()` (uses `next/headers()` — NOT inside cache scope)

**New queries requiring channel-aware caching:**
- Blog queries (`/blog`, `/blog/[slug]`) — CMS plugin
- Instructor media (`/instructor/[slug]`) — CMS plugin
- Marketplace filters — existing pattern
- Tenant registration — existing pattern

**Result:** Existing cache strategy is sound. New queries follow the same pattern:
1. Resolve `channelToken` at page level (outside cache scope)
2. Pass `channelToken` to cached data fetchers
3. Use `'use cache'` with `cacheTag()` for revalidation

---

## 5. Checklist

- [x] Add `CmsArticleFragment` — already exists
- [x] Confirm `ReviewFragment` comprehensive — already exists
- [x] Document INV-008 exception in `known-bugs.md`
- [x] Audit new mutation error handling — documented gaps
- [x] Confirm cache strategy — existing pattern is sound
- [x] Constrain Phase 1: `session-cta.ts` frozen
- [x] Create this checklist
