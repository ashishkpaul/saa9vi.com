/**
 * S5 (Phase 6 lean) — legacy alias.
 *
 * The tenant Meetings screen is `MeetingsHistoryList`; this module is kept so
 * that pre-refactor `import { MeetingsList } from './routes/meetings'` callers
 * keep resolving. It declares no GraphQL document of its own, which is also why
 * it left the INV-015 `UNTYPED_DOCUMENT_BASELINE` (the ratchet shrinks as
 * screens migrate to the typed graphql() helper).
 */
export { MeetingsHistoryList, MeetingsHistoryList as MeetingsList } from './MeetingsHistoryList';
