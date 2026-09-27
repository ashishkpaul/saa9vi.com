/**
 * Phase 8 verifier — implements §4 of docs/implementation/e2e-fixtures.md:
 * the per-tenant diff of the three axes (subscription / bbb / marketplace),
 * the cross-tenant isolation probe (INV-001), and PASS/FAIL/SKIP reporting.
 *
 * Failure semantics are normative (§4):
 *  1. any GraphQL error ⇒ FAIL with the operation name — a rejection is never
 *     read as an empty result set (only the isolation probe treats a rejection
 *     as the PASS condition, because §4 says those reads "must fail or return
 *     nothing"; that exception is marked inline);
 *  2. zero rows where `expected` implies rows ⇒ FAIL;
 *  3. a missing manifest entry or a missing/invalid axis ⇒ FAIL, never SKIP;
 *  4. SKIP is reserved for environment absence (server unreachable);
 *  5. exit 0 only when every check PASSed or was explicitly SKIPped.
 *
 * Usage: npm run test:e2e:fixtures   (E2E_HOST overrides http://localhost:3000)
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  FixtureGraphQLClient,
  GraphQLFixtureNetworkError,
} from './graphql-client';
import { loginTenantAdmin } from './auth';
import { E2EFixtureManifest, E2ETenantFixture } from './fixture-types';

const HOST = process.env.E2E_HOST ?? 'http://localhost:3000';
const MANIFEST_PATH = path.join(__dirname, '.fixtures', 'manifest.json');

const SUBSCRIPTION_STATES = ['active', 'past_due', 'pending_provider_auth', 'cancelled'] as const;
const BBB_STATES = ['live_session', 'scheduled_session', 'no_session'] as const;
const MARKETPLACE_STATES = ['published', 'unpublished'] as const;

type Verdict = 'PASS' | 'FAIL' | 'SKIP';
interface CheckResult {
  section: string;
  verdict: Verdict;
  detail: string;
}
const results: CheckResult[] = [];

function record(section: string, verdict: Verdict, detail: string): void {
  results.push({ section, verdict, detail });
  console.log(`[${verdict}] ${section}: ${detail}`);
}

function isNetwork(err: unknown): err is GraphQLFixtureNetworkError {
  return err instanceof GraphQLFixtureNetworkError;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function validAxis<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ── per-tenant axis checks (§4) ─────────────────────────────────────────────

async function checkSubscription(
  key: string,
  tenant: E2ETenantFixture,
  admin: FixtureGraphQLClient,
): Promise<void> {
  const section = `${key}/subscription`;
  if (!validAxis(tenant.expected.subscription, SUBSCRIPTION_STATES)) {
    record(section, 'FAIL', `manifest axis missing or invalid: ${JSON.stringify(tenant.expected.subscription)} (§4.3)`);
    return;
  }
  try {
    // The tenant-scoped read model: Shop `mySubscription` read WITH THAT
    // TENANT'S ADMIN SESSION presented to the Shop API (the documented
    // sign-in bridge) plus its channel token. The Admin API itself carries no
    // tenant-scoped subscription read — every Admin subscription query is
    // SuperAdmin-only, i.e. exactly the §4 global exception that may NOT
    // satisfy a tenant-scoped assertion.
    const data = await admin.shopQuery<{ mySubscription: { status: string } | null }>(
      section,
      `{ mySubscription { status plan { id } } }`,
    );
    const observed = data.mySubscription ? data.mySubscription.status : 'none';
    if (observed === tenant.expected.subscription) {
      record(section, 'PASS', `observed '${observed}' == expected (channel ${tenant.channelId})`);
    } else {
      record(
        section,
        'FAIL',
        `observed '${observed}' != expected '${tenant.expected.subscription}' (channel ${tenant.channelId})`,
      );
    }
  } catch (err) {
    if (isNetwork(err)) record(section, 'SKIP', errText(err));
    else record(section, 'FAIL', `GraphQL error never read as a lifecycle state (§4.1): ${errText(err)}`);
  }
}

async function checkBbb(
  key: string,
  tenant: E2ETenantFixture,
  admin: FixtureGraphQLClient,
): Promise<void> {
  const section = `${key}/bbb`;
  if (!validAxis(tenant.expected.bbb, BBB_STATES)) {
    record(section, 'FAIL', `manifest axis missing or invalid: ${JSON.stringify(tenant.expected.bbb)} (§4.3)`);
    return;
  }
  if (!tenant.bbbOrganizationId) {
    record(section, 'FAIL', 'manifest entry missing bbbOrganizationId (§4.3)');
    return;
  }
  try {
    const data = await admin.adminQuery<{
      bbbScheduledSessions: Array<{ id: string; title: string; status: string }>;
    }>(
      section,
      `query($orgId: ID!) {
        bbbScheduledSessions(organizationId: $orgId) { id title status }
      }`,
      { orgId: tenant.bbbOrganizationId },
    );
    // Typed rows or a thrown GraphQLFixtureError — so an empty array here is a
    // genuine empty result, never a masked rejection (§4.1 / INV-015).
    const sessions = data.bbbScheduledSessions;
    const live = sessions.filter(s => s.status.toUpperCase() === 'LIVE');
    const scheduled = sessions.filter(s => s.status.toUpperCase() === 'SCHEDULED');
    const shape =
      sessions.length > 0
        ? sessions.map(s => `${s.id}:${s.status}`).join(', ')
        : 'genuine empty (query succeeded with typed rows)';
    if (tenant.expected.bbb === 'scheduled_session') {
      if (scheduled.length >= 1 && live.length === 0) {
        record(section, 'PASS', `${scheduled.length} SCHEDULED, 0 LIVE — ${shape}`);
      } else {
        record(section, 'FAIL', `expected ≥1 SCHEDULED and 0 LIVE — ${shape}`);
      }
    } else if (tenant.expected.bbb === 'live_session') {
      if (live.length >= 1) record(section, 'PASS', `${live.length} LIVE — ${shape}`);
      else record(section, 'FAIL', `expected ≥1 LIVE — ${shape}`);
    } else {
      // no_session ⇒ neither scheduled nor live (a DRAFT row is neither — §4
      // reads FSM state; absence of SCHEDULED/LIVE is the assertion).
      if (scheduled.length === 0 && live.length === 0) {
        record(section, 'PASS', `neither SCHEDULED nor LIVE — ${shape}`);
      } else {
        record(section, 'FAIL', `expected neither SCHEDULED nor LIVE — ${shape}`);
      }
    }
  } catch (err) {
    if (isNetwork(err)) record(section, 'SKIP', errText(err));
    else record(section, 'FAIL', `GraphQL error never read as an empty result (§4.1): ${errText(err)}`);
  }
}

async function checkMarketplace(key: string, tenant: E2ETenantFixture): Promise<void> {
  const section = `${key}/marketplace`;
  if (!validAxis(tenant.expected.marketplace, MARKETPLACE_STATES)) {
    record(section, 'FAIL', `manifest axis missing or invalid: ${JSON.stringify(tenant.expected.marketplace)} (§4.3)`);
    return;
  }
  if (!tenant.channelToken || !tenant.sessionTitle) {
    record(section, 'FAIL', 'manifest entry missing channelToken/sessionTitle (§4.3)');
    return;
  }
  // Anonymous storefront client — one per actor (§5), scoped to this tenant's
  // channel token: the public surface a real shopper would hit.
  const storefront = new FixtureGraphQLClient(HOST).withChannelToken(tenant.channelToken);
  // A published listing may need a moment to land in the index after a reseed;
  // unpublished is asserted on the first attempt (no leniency for a leak).
  const attempts = tenant.expected.marketplace === 'published' ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const data = await storefront.shopQuery<{
        marketplaceSearch: {
          totalSessions: number;
          sessions: Array<{ id: string; channelId: string; title: string }>;
        };
      }>(
        section,
        `query($input: MarketplaceSearchInput!) {
          marketplaceSearch(input: $input) { totalSessions sessions { id channelId title } }
        }`,
        { input: { query: tenant.sessionTitle } },
      );
      const hits = data.marketplaceSearch.sessions.filter(
        s => s.channelId === tenant.channelId && s.title === tenant.sessionTitle,
      );
      if (tenant.expected.marketplace === 'published') {
        if (hits.length >= 1) {
          record(section, 'PASS', `listing reachable by recorded title on channel ${tenant.channelId} (${hits.length} hit(s), totalSessions=${data.marketplaceSearch.totalSessions})`);
          return;
        }
        if (attempt < attempts) {
          await delay(700);
          continue;
        }
        record(
          section,
          'FAIL',
          `expected published: no session with channelId ${tenant.channelId} + recorded title after ${attempts} attempt(s) (totalSessions=${data.marketplaceSearch.totalSessions})`,
        );
        return;
      }
      if (hits.length === 0) {
        record(section, 'PASS', `absent from the public surface (totalSessions=${data.marketplaceSearch.totalSessions})`);
        return;
      }
      record(
        section,
        'FAIL',
        `LEAK: unpublished listing reachable — ${hits.map(h => h.id).join(', ')} on channel ${tenant.channelId}`,
      );
      return;
    } catch (err) {
      if (isNetwork(err)) record(section, 'SKIP', errText(err));
      else record(section, 'FAIL', `GraphQL error never read as an empty page (§4.1): ${errText(err)}`);
      return;
    }
  }
}

// ── tenant session ──────────────────────────────────────────────────────────

type SessionOutcome =
  | { kind: 'ok'; client: FixtureGraphQLClient }
  | { kind: 'env'; detail: string } // environment absence → dependent checks SKIP
  | { kind: 'login'; detail: string }; // our own credential failing → FAIL (§4.3)

async function openSession(key: string, tenant: E2ETenantFixture): Promise<SessionOutcome> {
  try {
    const client = await loginTenantAdmin(HOST, tenant.admin.email, tenant.admin.password);
    return { kind: 'ok', client: client.withChannelToken(tenant.channelToken) };
  } catch (err) {
    if (isNetwork(err)) {
      record(`${key}/session`, 'SKIP', `server unreachable: ${errText(err)}`);
      return { kind: 'env', detail: errText(err) };
    }
    record(`${key}/session`, 'FAIL', `tenant admin login failed: ${errText(err)}`);
    return { kind: 'login', detail: errText(err) };
  }
}

// ── cross-tenant isolation probe (INV-001, §4) ──────────────────────────────
/**
 * With tenant A's session, request tenant B's RECORDED ids (or B's channel
 * token). Every such read must FAIL or return NOTHING; a leak fails the run.
 * This is the only place a GraphQL rejection counts as PASS — §4 explicitly
 * requires those reads to "fail or return nothing".
 */
async function checkIsolation(
  meKey: string,
  me: E2ETenantFixture,
  session: FixtureGraphQLClient,
  others: Array<[string, E2ETenantFixture]>,
): Promise<void> {
  for (const [otherKey, other] of others) {
    const section = `isolation ${meKey}->${otherKey}`;

    // (a) B's recorded session id from A's admin session + A's channel token.
    if (!other.scheduledSessionId) {
      record(`${section}/bbbScheduledSession`, 'FAIL', `manifest entry for ${otherKey} missing scheduledSessionId (§4.3)`);
    } else {
      try {
        const data = await session.adminQuery<{
          bbbScheduledSession: { id: string; title: string } | null;
        }>(
          `${section}/bbbScheduledSession`,
          `query($id: ID!) { bbbScheduledSession(id: $id) { id title } }`,
          { id: other.scheduledSessionId },
        );
        if (data.bbbScheduledSession === null) {
          record(`${section}/bbbScheduledSession`, 'PASS', `null — ${otherKey}'s row id returned nothing`);
        } else {
          record(
            `${section}/bbbScheduledSession`,
            'FAIL',
            `LEAK: returned ${otherKey} row ${data.bbbScheduledSession.id} "${data.bbbScheduledSession.title}"`,
          );
        }
      } catch (err) {
        if (isNetwork(err)) record(`${section}/bbbScheduledSession`, 'SKIP', errText(err));
        else record(`${section}/bbbScheduledSession`, 'PASS', `rejection (§4: must fail or return nothing): ${errText(err)}`);
      }
    }

    // (b) B's recorded customer ids (instructor + student) via customer(id).
    const customerProbes: Array<[string, string]> = [
      ['instructor.customerId', other.instructor.customerId],
      ['student.customerId', other.student.customerId],
    ];
    for (const [label, id] of customerProbes) {
      const name = `${section}/customer(${label})`;
      if (!id) {
        record(name, 'FAIL', `manifest entry for ${otherKey} missing ${label} (§4.3)`);
        continue;
      }
      try {
        const data = await session.adminQuery<{ customer: { id: string; emailAddress?: string } | null }>(
          name,
          `query($id: ID!) { customer(id: $id) { id emailAddress } }`,
          { id },
        );
        if (data.customer === null) {
          record(name, 'PASS', `null — ${otherKey}'s customer id returned nothing`);
        } else {
          record(name, 'FAIL', `LEAK: returned ${otherKey} customer ${data.customer.id} (${data.customer.emailAddress ?? 'no email'})`);
        }
      } catch (err) {
        if (isNetwork(err)) record(name, 'SKIP', errText(err));
        else record(name, 'PASS', `rejection (§4: must fail or return nothing): ${errText(err)}`);
      }
    }

    // (c) B's recorded profile id must not appear in A's channel-scoped listing.
    if (!other.instructor.profileId) {
      record(`${section}/instructorProfiles`, 'FAIL', `manifest entry for ${otherKey} missing profileId (§4.3)`);
    } else {
      try {
        const data = await session.adminQuery<{ instructorProfiles: { items: Array<{ id: string }> } }>(
          `${section}/instructorProfiles`,
          `{ instructorProfiles { items { id } } }`,
        );
        const leaked = data.instructorProfiles.items.some(item => item.id === other.instructor.profileId);
        if (leaked) {
          record(`${section}/instructorProfiles`, 'FAIL', `LEAK: ${otherKey} profile ${other.instructor.profileId} visible in ${meKey}'s listing`);
        } else {
          record(`${section}/instructorProfiles`, 'PASS', `${otherKey}'s profile id absent from ${meKey}'s listing (${data.instructorProfiles.items.length} own row(s))`);
        }
      } catch (err) {
        if (isNetwork(err)) record(`${section}/instructorProfiles`, 'SKIP', errText(err));
        else record(`${section}/instructorProfiles`, 'PASS', `rejection (§4: must fail or return nothing): ${errText(err)}`);
      }
    }

    // (d) A's admin session presented with B's CHANNEL TOKEN against B's org:
    // A's role is assigned only to A's channel (INV-001), so this must be
    // rejected — and if it returns any row, that row is a leak.
    if (!other.channelToken || !other.bbbOrganizationId) {
      record(`${section}/token-probe`, 'FAIL', `manifest entry for ${otherKey} missing channelToken/bbbOrganizationId (§4.3)`);
      continue;
    }
    session.withChannelToken(other.channelToken);
    try {
      const data = await session.adminQuery<{ bbbScheduledSessions: Array<{ id: string }> }>(
        `${section}/token-probe`,
        `query($orgId: ID!) { bbbScheduledSessions(organizationId: $orgId) { id } }`,
        { orgId: other.bbbOrganizationId },
      );
      if (data.bbbScheduledSessions.length === 0) {
        record(`${section}/token-probe`, 'PASS', `empty — ${meKey} session on ${otherKey} token returned no rows`);
      } else {
        record(
          `${section}/token-probe`,
          'FAIL',
          `LEAK: ${meKey} session on ${otherKey} channel token returned rows ${data.bbbScheduledSessions.map(r => r.id).join(', ')}`,
        );
      }
    } catch (err) {
      if (isNetwork(err)) record(`${section}/token-probe`, 'SKIP', errText(err));
      else record(`${section}/token-probe`, 'PASS', `rejection (§4: must fail or return nothing): ${errText(err)}`);
    } finally {
      session.withChannelToken(me.channelToken); // restore A's own scoping
    }
  }
}

// ── orchestration & reporting ───────────────────────────────────────────────

async function main(): Promise<void> {
  if (!fs.existsSync(MANIFEST_PATH)) {
    record(
      'manifest',
      'FAIL',
      `missing at ${MANIFEST_PATH} — run npm run test:e2e:fixtures:seed first (a missing manifest entry is a FAIL, not a SKIP: §4.3)`,
    );
    finish();
    return;
  }
  let manifest: E2EFixtureManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as E2EFixtureManifest;
  } catch (err) {
    record('manifest', 'FAIL', `unreadable: ${errText(err)}`);
    finish();
    return;
  }
  const tenants = Object.entries(manifest.tenants);
  if (tenants.length < 2) {
    record(
      'manifest',
      'FAIL',
      `the fixture set must hold at least two deliberately different tenants (§7); found ${tenants.length}`,
    );
    finish();
    return;
  }

  // Environment probe: is the server reachable at all? (§4.4 — SKIP iff not.)
  try {
    await new FixtureGraphQLClient(HOST).shopQuery('EnvironmentProbe', `{ __typename }`);
  } catch (err) {
    if (isNetwork(err)) record('environment', 'SKIP', `server unreachable at ${HOST}: ${errText(err)}`);
    else record('environment', 'FAIL', `server answered with an error: ${errText(err)}`);
    finish();
    return;
  }

  const sessions = new Map<string, SessionOutcome>();
  for (const [key, tenant] of tenants) sessions.set(key, await openSession(key, tenant));

  for (const [key, tenant] of tenants) {
    const outcome = sessions.get(key);
    if (outcome && outcome.kind === 'ok') {
      await checkSubscription(key, tenant, outcome.client);
      await checkBbb(key, tenant, outcome.client);
    } else {
      const verdict: Verdict = outcome && outcome.kind === 'env' ? 'SKIP' : 'FAIL';
      const why =
        outcome && outcome.kind === 'env'
          ? `server unreachable: ${outcome.detail}`
          : 'not observable — tenant admin session unavailable';
      record(`${key}/subscription`, verdict, why);
      record(`${key}/bbb`, verdict, why);
    }
    // The marketplace axis is a public-surface read — independent of the admin session.
    await checkMarketplace(key, tenant);
  }

  for (const [meKey, me] of tenants) {
    const outcome = sessions.get(meKey);
    const others = tenants.filter(([k]) => k !== meKey);
    if (!outcome) continue;
    if (outcome.kind !== 'ok') {
      const verdict: Verdict = outcome.kind === 'env' ? 'SKIP' : 'FAIL';
      record(
        `isolation ${meKey}`,
        verdict,
        outcome.kind === 'env'
          ? `server unreachable: ${outcome.detail}`
          : `no probing session for ${meKey} — tenant admin session unavailable`,
      );
      continue;
    }
    await checkIsolation(meKey, me, outcome.client, others);
  }

  finish();
}

function finish(): void {
  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const skip = results.filter(r => r.verdict === 'SKIP').length;
  console.log(`\n---\nSummary: ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(errText(err));
  process.exit(1);
});
