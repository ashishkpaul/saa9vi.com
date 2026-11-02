/**
 * Platform-shared ID utilities (C-09).
 *
 * Two concerns are intentionally kept separate:
 *
 * 1. `channelIdOf(ctx)` — extract the current request channel ID as a string,
 *    regardless of whether the ID strategy uses integers or strings.
 *
 * 2. `decodeEntityId(id, configService)` — decode a GraphQL-facing entity ID
 *    (which may be "T_3" in test or "3" in production) to the raw PK string
 *    stored in varchar columns.
 *
 * Do NOT combine these: a channel ID is a channel ID, an entity PK is an
 * entity PK. Mixing them causes the "2" vs 2 integer/string coercion bugs
 * documented in BbbChannelAccessService and TenantDeletionService.
 *
 * Existing callers that used private rawId() helpers (TenantDeletionService,
 * BbbDeletionService) can import decodeEntityId from here instead of
 * duplicating the pattern.
 */

import { ConfigService, ID, RequestContext } from '@vendure/core';

/**
 * Returns ctx.channelId normalised to a string.
 * Use this anywhere a scalar channelId string is required for a query where
 * clause or a comparison.
 */
export function channelIdOf(ctx: RequestContext): string {
  return String(ctx.channelId);
}

/**
 * Decode a GraphQL-encoded entity ID to the raw PK string stored in varchar
 * columns.
 *
 * Under the default AutoIncrementIdStrategy, encodeId/decodeId are identity
 * functions and this returns String(id). Under the test
 * TestingEntityIdStrategy, an ID like "T_3" decodes to 3 and the function
 * returns "3". Both environments converge on the stored value.
 *
 * Returns String(id) unchanged when the strategy reports "not found" (−1).
 */
export function decodeEntityId(id: ID, configService: ConfigService): string {
  const decoded = configService.entityIdStrategy.decodeId(String(id));
  return decoded === -1 ? String(id) : String(decoded);
}
