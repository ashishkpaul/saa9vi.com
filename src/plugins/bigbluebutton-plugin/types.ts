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
}
