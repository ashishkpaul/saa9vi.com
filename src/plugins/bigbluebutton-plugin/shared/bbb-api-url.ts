/**
 * Canonicalise an operator-supplied BBB API base URL (`BbbServer.apiUrl`).
 *
 * Two paste shapes reach the column in practice:
 *
 *   - canonical base   `https://bbb.example.com/bigbluebutton`
 *     (what the entity, the README and API-Mate's "API Base" field show), and
 *   - full API root    `https://bbb.example.com/bigbluebutton/api`
 *     (what people copy from the address bar after opening a BBB API call),
 *     usually with a trailing slash too.
 *
 * `BbbApiService` ALWAYS builds requests as `<apiUrl>/api/<methodName>`, so a
 * stored `/api` suffix would produce `…/api/api/create` and 404 every call.
 * This function makes the canonical form the only form:
 *
 *   1. trim surrounding whitespace;
 *   2. drop ALL trailing slashes (`…/bigbluebutton/api///`);
 *   3. drop ONE trailing `/api` segment, then any slashes that reveals —
 *      exactly one, because the builder re-adds exactly one: a legitimate
 *      context path that itself ends in `/api` survives a full round trip,
 *      while the pasted API root collapses to its base.
 *
 * Applied in TWO places, deliberately:
 *
 *   - **on save** — `BbbServerService.create/update` persist the canonical
 *     form for new/edited rows;
 *   - **on build** — `BbbApiService.buildApiUrl`/`buildJoinUrl` normalise
 *     whatever they load. This is what makes pre-existing rows correct with
 *     NO data migration and no hand-edited rows: the value is derived at
 *     use, and the migration-governance rule (Vendure CLI only, ADR-documented
 *     exceptions) is untouched because no schema change exists.
 *
 * NOT a validator: malformed input passes through unchanged. Presence checks
 * live at the edges (`assertProductionSecrets` for the callback base, admin
 * input validation for this column).
 *
 * @param raw operator-supplied base (any of the paste shapes above)
 * @returns canonical base WITHOUT trailing slashes and WITHOUT one trailing `/api`
 */
export function normalizeBbbApiUrl(raw: string): string {
  // `?? ""` guards a null/undefined column at runtime (a legacy row loaded
  // through a partial select); the type says string because callers pass one.
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api")) {
    return trimmed.slice(0, -"/api".length).replace(/\/+$/, "");
  }
  return trimmed;
}
