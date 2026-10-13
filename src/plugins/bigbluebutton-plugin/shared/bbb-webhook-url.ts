/**
 * Shared helper: canonical callback URL that BBB signs at registration and
 * uses in every subsequent delivery checksum.
 *
 * The URL is built from `BigBlueButtonPluginOptions.publicBaseUrl` — the
 * publicly reachable HTTPS base of this Saa9vi instance — so it is
 * independent of reverse-proxy `Host` / `X-Forwarded-*` headers. BBB signs
 * the URL that was REGISTERED; we must reconstruct the EXACT string to verify
 * checksums correctly (W3) and to detect stale hooks (W4).
 *
 * Trailing slash in publicBaseUrl is normalised away; serverId may be any
 * opaque string (Vendure entity ID).
 *
 * Used by:
 *   - W3 BbbWebhookController — checksum construction
 *   - W4 BbbHooksService      — hooks/create and hooks/list stale-hook detection
 */
export function webhookCallbackUrl(
  publicBaseUrl: string,
  serverId: string,
): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/bbb/webhook/${serverId}`;
}
