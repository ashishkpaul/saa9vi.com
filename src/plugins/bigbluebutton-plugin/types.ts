export interface BigBlueButtonPluginOptions {
  /**
   * Public base URL of the storefront (e.g. "https://storefront.lan").
   * Used to construct the BBB `logoutURL` so the iframe redirects to
   * /bbb-logout instead of the storefront homepage when a session ends.
   * Falls back to STOREFRONT_URL env var.
   */
  storefrontUrl?: string;

  /**
   * Optional prefix for BBB meeting IDs to avoid collisions across channels.
   * @default "bbb"
   */
  meetingIdPrefix?: string;

  /**
   * Seconds until the attendee join URL expires.
   * @default 86400 (24 hours)
   */
  attendeeJoinUrlTtlSeconds?: number;

  /**
   * If true, the plugin will register scheduled jobs.
   * @default true
   */
  runScheduledTasks?: boolean;

  // ─── Scalability & Performance Tuning ────────────────────────────────────

  /**
   * Redis host for distributed room locking.
   * Falls back to REDIS_HOST env var, then "localhost".
   */
  redisHost?: string;

  /**
   * Redis port for distributed room locking.
   * Falls back to REDIS_PORT env var, then 6379.
   */
  redisPort?: number;

  /**
   * Redis password for distributed room locking.
   * Falls back to REDIS_PASSWORD env var.
   */
  redisPassword?: string;

  /**
   * When true, Redis failure blocks provisioning instead of failing open.
   * Falls back to BBB_ROOM_LOCK_STRICT env var.
   * @default false
   */
  roomLockStrict?: boolean;

  /**
   * TTL (seconds) for distributed room provisioning locks.
   * @default 30
   */
  lockTtlSeconds?: number;

  /**
   * Heartbeat interval (ms) for extending lock TTL during long provisioning.
   * @default 10000
   */
  lockHeartbeatIntervalMs?: number;

  /**
   * Debounce window (ms): suppresses rapid re-provision requests for the same room.
   * @default 15000
   */
  provisionDebounceMs?: number;

  /**
   * TTL (ms) for caching BBB runtime validation results (avoids hammering BBB APIs).
   * @default 10000
   */
  runtimeValidationTtlMs?: number;

  /**
   * Max auto-retries for room provisioning before the room requires manual reset.
   * @default 3
   */
  maxAutoRetries?: number;

  /**
   * Grace period (ms) after provisioning during which the local DB state is trusted
   * and the BBB API is not interrogated. BBB needs this time to initialise meeting context.
   * @default 90000
   */
  meetingGracePeriodMs?: number;

  /**
   * How long (ms) a meeting can stay in Provisioning state before reconciliation
   * considers it stuck and retries or fails it.
   * @default 300000 (5 min)
   */
  stuckProvisioningTimeoutMs?: number;

  /**
   * Minimum meeting duration (ms) before billing is applied.
   * Meetings shorter than this are not billed (fair billing guard).
   * @default 120000 (2 min)
   */
  fairBillingMinDurationMs?: number;

  /**
   * Maximum meeting duration (ms) before reconciliation force-completes
   * the meeting and caps billing. Protects against orphaned meetings on
   * a crashed BBB node accumulating unbounded consumption.
   * @default 86400000 (24 hours)
   */
  maxMeetingDurationMs?: number;

  /**
   * How long (ms) a room can stay in Provisioning with no linked meeting before
   * reconciliation resets it to Idle (assumes the provisioning job was lost).
   * @default 300000 (5 min)
   */
  roomStaleTimeoutMs?: number;

  /**
   * Number of retries for the bbb-meeting-provisioning BullMQ job.
   * @default 3
   */
  provisioningJobRetries?: number;

  /**
   * Backoff delay (ms) between provisioning job retries (exponential backoff).
   * @default 5000
   */
  provisioningJobBackoffMs?: number;

  /**
   * Platform default learner-hour rate in paise for `metered` organizations
   * (ADR-047 / D2).
   *
   * Used only when the organization has no `ratePaisePerLearnerHour`. This is a
   * plugin option on purpose: `BbbPlatformCapacityPolicy` documents itself as a
   * *capacity* policy (ADR-031) and must not absorb pricing.
   *
   * @default `DEFAULT_RATE_PLACEHOLDER_PAISE_PER_LEARNER_HOUR` (constants.ts) —
   * a clearly marked PLACEHOLDER (2000 paise = ₹20.00/learner-hour, Q2) applied
   * only when this option is omitted. Set an explicit value (including `0`,
   * which means "configured — bill nothing") to override the placeholder; a
   * per-org `ratePaisePerLearnerHour` overrides both.
   */
  defaultRatePaisePerLearnerHour?: number;

  // ─── BBB protocol (W7) ──────────────────────────────────────────────────

  /**
   * Checksum algorithm the adapter signs BBB API requests with:
   * `checksum = hex( <algorithm>(methodName + queryString + apiSecret) )`.
   *
   * BBB servers advertise the set they accept via `supportedChecksumAlgorithms`
   * (W0: `bbb-conf --version` on the deployed server). Default `sha256`;
   * `sha1` is the legacy algorithm BBB's own API docs still show in the
   * canonical example. Unknown values fall back to `sha256`.
   *
   * @default 'sha256'
   */
  checksumAlgorithm?: "sha256" | "sha1";

  // ─── Public callback base (W3/W4 webhooks) ─────────────────────────────

  /**
   * Publicly reachable base URL of this Saa9vi instance (scheme + host; a
   * trailing slash is tolerated and normalised at use).
   *
   * W3/W4: BBB hook registration builds the callback as
   * `publicBaseUrl + /bbb/webhook/<serverId>`, and BBB signs the URL that
   * was REGISTERED — so webhook verification reconstructs the exact string
   * from this option, never from the incoming request's host/scheme (a
   * reverse proxy rewrites both). Changing it after hooks are registered
   * requires re-registering them on the BBB server.
   *
   * REQUIRED in any non-dev deployment: boot refuses without it
   * (`assertProductionSecrets` / `BBB_PUBLIC_BASE_URL`), so hook
   * registration can never use a guessed URL. Non-dev must be `https://`
   * (W4 amendment; plain http is refused at boot — the registered callback
   * carries the auth material W3 verifies).
   *
   * @default undefined (dev only)
   */
  publicBaseUrl?: string;

  // ─── Tenant provisioning (ADR-047 Phase 3) ──────────────────────────────

  /**
   * Room names created for every newly provisioned `BbbOrganization` as part of
   * tenant registration, so a fresh tenant lands in a working academy instead
   * of an empty room list (Phase 3).
   *
   * Seeding is idempotent: it runs only while the organization has ZERO rooms
   * (`BbbTenantProvisioningListener.seedDefaultRooms`), so a re-delivered
   * `TenantRegisteredEvent` never duplicates them, and a seeding failure is
   * logged without failing organization provisioning.
   *
   * @default `DEFAULT_SEEDED_ROOM_NAMES` (constants.ts) — `["Main Classroom"]`.
   * An explicit `[]` disables seeding (a deliberate opt-out, not a fallback).
   */
  defaultRooms?: string[];

  // ─── Capacity Intelligence Load Estimation (CI-001) ──────────────────────

  /**
   * Ratio of attendees expected to enable camera during a session.
   * Used by CapacityIntelligenceService for PILOS virtual load forecasting.
   * @default 0.40
   */
  cameraRatio?: number;

  /**
   * Ratio of attendees expected to unmute (enable mic) during a session.
   * Used by CapacityIntelligenceService for PILOS virtual load forecasting.
   * @default 0.70
   */
  micRatio?: number;

  /**
   * PILOS virtual load weight for video streams.
   * @default 3
   */
  videoWeight?: number;

  /**
   * PILOS virtual load weight for microphone streams.
   * @default 2
   */
  micWeight?: number;

  /**
   * PILOS virtual load weight for listen-only attendees.
   * @default 1
   */
  listenerWeight?: number;
}
