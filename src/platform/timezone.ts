/**
 * Saa9vi platform timezone — Asia/Kolkata (IST, UTC+5:30).
 *
 * Billing months (`monthOf`) and the daily-allowance window
 * (`startOfServerDay`) share this ONE definition so a meeting that ends at
 * 23:55 UTC books to the same calendar day/month in both paths. IST has no
 * DST, so a fixed +5:30 offset is exact — no `Intl` dependency, deterministic
 * under any server TZ.
 *
 * New rows only: `periodMonth` is snapshotted at write time and grant
 * `validFrom` at grant write, so rows written before this change keep their
 * UTC keys. A backfill would re-price history and is explicitly out of scope.
 */
export const PLATFORM_TIMEZONE = "Asia/Kolkata" as const;

/** IST offset in milliseconds (UTC+5:30, no DST — exact). */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Shift an instant into IST wall-clock representation: the returned Date has
 * the same UTC instant but its UTC getters read as IST wall time.
 */
export function toIstWallClock(at: Date): Date {
  return new Date(at.getTime() + IST_OFFSET_MS);
}

/**
 * IST calendar date parts for an instant — the single day/month reference for
 * billing and allowance windows.
 */
export function istDateParts(at: Date): { year: number; month: number; day: number } {
  const shifted = toIstWallClock(at);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}
