/**
 * Phase 8 fixture seeder — docs/implementation/e2e-fixtures.md §7.
 *
 * Materialises every scenario tenant against a LIVE server through the public
 * GraphQL surfaces only, then writes the manifest (gitignored run artifact) to
 * `scripts/e2e/.fixtures/manifest.json`.
 *
 * Contracts honoured here:
 *  - ids recorded, never re-derived: every id the seeder creates lands in the
 *    manifest (fixture-types.ts, e2e-fixtures.md §3);
 *  - idempotent per label: re-running REFRESHES each tenant (find-or-create at
 *    every step) instead of duplicating it (§4 determinism);
 *  - no resurrection: a channel whose subscription is already `cancelled` is
 *    never re-subscribed — repeated runs cannot create a second row and walk
 *    into BUG-040's unordered-read drift;
 *  - provider boundary respected (ADR-039/ADR-044): `subscribeToPlan` REQUIRES
 *    a providerPlanId and calls the external provider, so this seeder never
 *    uses it. Registration auto-provisions an active provider-free subscription
 *    (FreePlanProvisioningService) and `changeOrganizationSubscriptionPlan`
 *    with a provider-free target lands `active` locally — zero Razorpay calls
 *    (§6: this layer is not provider-state verification);
 *  - session auth is the fixed `login` shape in auth.ts (§5), one client per
 *    actor, `vendure-token` for channel scoping.
 *
 * Usage: npm run test:e2e:fixtures:seed   (E2E_HOST overrides http://localhost:3000)
 */
import * as fs from 'fs';
import * as path from 'path';
import { FixtureGraphQLClient, GraphQLFixtureError, GraphQLFixtureNetworkError } from './graphql-client';
import { loginSuperAdmin, loginTenantAdmin } from './auth';
import {
  E2EFixtureManifest,
  E2EScenario,
  E2ETenantFixture,
  E2ETenantSpec,
} from './fixture-types';
import { tenantDivergenceScenario } from './scenarios/tenant-divergence';

const HOST = process.env.E2E_HOST ?? 'http://localhost:3000';
const MANIFEST_PATH = path.join(__dirname, '.fixtures', 'manifest.json');
const SCENARIOS: E2EScenario[] = [tenantDivergenceScenario];

/**
 * Mirrors the live channelCode slugification: lower-cased, runs of non
 * [a-z0-9] collapsed to '-' ("Slice9 Bridge Probe" → "slice9-bridge-probe-nciws6").
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface ChannelRow {
  id: string;
  code: string;
  token: string;
}

interface MailboxItem {
  fileName: string;
  date: string;
  subject: string;
  recipient: string;
}

// ── mailbox → verifyTenantAdmin (the slice-9 onboarding chain) ─────────────

async function mailboxTokens(email: string): Promise<string[]> {
  let items: MailboxItem[];
  try {
    const res = await fetch(`${HOST}/mailbox/list`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = (await res.json()) as MailboxItem[];
  } catch (err) {
    throw new GraphQLFixtureError(
      `dev mailbox unreachable (${err instanceof Error ? err.message : String(err)})`,
      'MailboxList',
    );
  }
  // Newest first: fileName starts with an ISO timestamp
  // ("2026-09-27t034424.627z_…"), so lexicographic order is recency order.
  const matching = items
    .filter(item => item.recipient === email)
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
  const tokens: string[] = [];
  for (const item of matching) {
    const res = await fetch(`${HOST}/mailbox/item/${item.fileName}`);
    if (!res.ok) continue;
    const body = await res.text();
    const found = body.match(/token=([A-Za-z0-9_-]+)/);
    if (found) tokens.push(found[1]);
  }
  return tokens;
}

/** Consume verification tokens until the admin login succeeds. */
async function verifyTenantAdmin(email: string, password: string): Promise<FixtureGraphQLClient> {
  const anon = new FixtureGraphQLClient(HOST);
  const tokens = await mailboxTokens(email);
  if (tokens.length === 0) {
    throw new GraphQLFixtureError(
      `admin login for ${email} failed and the dev mailbox holds no verification email — cannot verify`,
      'VerifyTenantAdmin',
    );
  }
  let lastError: unknown = new GraphQLFixtureError('no verification token worked', 'VerifyTenantAdmin');
  for (const token of tokens) {
    const result = await anon.shopMutation<{
      verifyTenantAdmin: { success: boolean; message: string | null };
    }>(
      'VerifyTenantAdmin',
      'mutation($t: String!) { verifyTenantAdmin(token: $t) { success message } }',
      { t: token },
    );
    if (!result.verifyTenantAdmin.success) {
      lastError = new GraphQLFixtureError(
        result.verifyTenantAdmin.message ?? 'unsuccessful',
        'VerifyTenantAdmin',
      );
      continue;
    }
    try {
      return await loginTenantAdmin(HOST, email, password);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function loginAdminOrVerify(spec: E2ETenantSpec): Promise<FixtureGraphQLClient> {
  try {
    return await loginTenantAdmin(HOST, spec.admin.email, spec.admin.password);
  } catch (err) {
    if (err instanceof GraphQLFixtureNetworkError) throw err;
    // Fresh registration creates an UNVERIFIED administrator: login fails
    // (null CurrentUser + INTERNAL — release-notes slice 9) until the mailbox
    // token has been consumed by verifyTenantAdmin.
    return verifyTenantAdmin(spec.admin.email, spec.admin.password);
  }
}

// ── channel discovery / registration ───────────────────────────────────────

async function discoverChannel(
  sa: FixtureGraphQLClient,
  spec: E2ETenantSpec,
  remembered: E2ETenantFixture | undefined,
): Promise<ChannelRow | undefined> {
  const data = await sa.adminQuery<{ channels: { items: ChannelRow[] } }>(
    'Channels',
    `{ channels { items { id code token } } }`,
  );
  const prefix = `${slugify(spec.businessName)}-`;
  const matches = data.channels.items.filter(channel => channel.code.startsWith(prefix));
  if (matches.length === 0) return undefined;
  if (remembered) {
    const rememberedMatch = matches.find(channel => channel.id === remembered.channelId);
    if (rememberedMatch) return rememberedMatch;
  }
  if (matches.length === 1) return matches[0];
  throw new GraphQLFixtureError(
    `ambiguous channel discovery for ${spec.key}: codes ${matches
      .map(channel => channel.code)
      .join(', ')} — restore the manifest or delete the stale channels`,
    'DiscoverChannel',
  );
}

async function registerTenant(spec: E2ETenantSpec): Promise<void> {
  const anon = new FixtureGraphQLClient(HOST);
  await anon.shopMutation<{
    registerNewTenant: { channelId: string; channelToken: string; administratorId: string };
  }>(
    'RegisterNewTenant',
    `mutation RegisterNewTenant($input: RegisterTenantInput!) {
      registerNewTenant(input: $input) { channelId channelToken administratorId }
    }`,
    {
      input: {
        businessName: spec.businessName,
        firstName: spec.instructor.firstName,
        lastName: spec.instructor.lastName,
        emailAddress: spec.admin.email,
        password: spec.admin.password,
        contactEmail: spec.admin.email,
        timezone: 'Asia/Kolkata',
      },
    },
  );
}

// ── plan & subscription (provider-free only — no Razorpay) ─────────────────

async function ensurePlan(sa: FixtureGraphQLClient, spec: E2ETenantSpec): Promise<string> {
  const data = await sa.adminQuery<{ subscriptionPlans: Array<{ id: string; slug: string }> }>(
    'SubscriptionPlans',
    `{ subscriptionPlans { id slug } }`,
  );
  const existing = data.subscriptionPlans.find(plan => plan.slug === spec.plan.slug);
  if (existing) return existing.id;
  const created = await sa.adminMutation<{ createSubscriptionPlan: { id: string } }>(
    'CreateSubscriptionPlan',
    `mutation($input: SubscriptionPlanInput!) { createSubscriptionPlan(input: $input) { id } }`,
    {
      input: {
        name: spec.plan.name,
        slug: spec.plan.slug,
        monthlyPriceInPaise: spec.plan.monthlyPriceInPaise,
        marketplaceListingEnabled: spec.plan.marketplaceListingEnabled,
        isActive: true,
      },
    },
  );
  return created.createSubscriptionPlan.id;
}

interface MySubscriptionView {
  status: string;
  plan: { id: string };
}

async function readSubscription(admin: FixtureGraphQLClient): Promise<MySubscriptionView | null> {
  const data = await admin.shopQuery<{ mySubscription: MySubscriptionView | null }>(
    'MySubscription',
    `{ mySubscription { status plan { id } } }`,
  );
  // `null` is a genuine observation (channel has no subscription) — never a
  // masked absence: the client throws on any GraphQL error before we get here.
  return data.mySubscription;
}

async function ensureSubscription(
  sa: FixtureGraphQLClient,
  channelId: string,
  planId: string,
  expected: E2ETenantSpec['expected']['subscription'],
  current: MySubscriptionView | null,
): Promise<void> {
  if (expected === 'cancelled') {
    if (current === null) {
      throw new GraphQLFixtureError(
        `channel ${channelId} has no subscription to cancel — registration should auto-` +
          `provision the provider-free Free Basic row (FreePlanProvisioningService); is the ` +
          `'free-basic' plan present?`,
        'EnsureSubscription',
      );
    }
    if (current.status === 'cancelled') return; // §4: cancelled stays cancelled — NEVER re-subscribe (BUG-040 guard)
    await sa.adminMutation(
      'CancelOrganizationSubscription',
      `mutation($c: String!, $atPeriodEnd: Boolean!) {
        cancelOrganizationSubscription(channelId: $c, atPeriodEnd: $atPeriodEnd) { id status }
      }`,
      { c: channelId, atPeriodEnd: false },
    );
    return;
  }
  if (expected === 'active') {
    if (current === null) {
      throw new GraphQLFixtureError(
        `channel ${channelId} has no subscription — subscribeToPlan requires a providerPlanId ` +
          `(ADR-039), so a first row can only come from registration provisioning`,
        'EnsureSubscription',
      );
    }
    if (current.status === 'cancelled') {
      throw new GraphQLFixtureError(
        `channel ${channelId} is cancelled but the fixture expects 'active' — re-subscribing ` +
          `would create a second row alongside the cancelled one (BUG-040 partial-index class); ` +
          `clean up manually before re-seeding`,
        'EnsureSubscription',
      );
    }
    if (current.plan.id === planId) {
      if (current.status === 'active') return;
      throw new GraphQLFixtureError(
        `channel ${channelId} subscription is '${current.status}' on the expected plan, not ` +
          `'active' — not a state this provider-free fixture reaches deterministically`,
        'EnsureSubscription',
      );
    }
    // Supersede-in-place onto the fixture plan: a provider-free target lands
    // 'active' locally (ADR-044 §4, subscription.service.ts) — no provider call.
    await sa.adminMutation(
      'ChangeOrganizationSubscriptionPlan',
      `mutation($c: String!, $p: ID!) {
        changeOrganizationSubscriptionPlan(channelId: $c, planId: $p) { id status }
      }`,
      { c: channelId, p: planId },
    );
    return;
  }
  throw new GraphQLFixtureError(
    `expected.subscription '${expected}' is not seedable by this seeder`,
    'EnsureSubscription',
  );
}

// ── customers & instructor profile ─────────────────────────────────────────

async function ensureCustomer(
  admin: FixtureGraphQLClient,
  person: { firstName: string; lastName: string; email: string },
  password: string,
): Promise<string> {
  const found = await admin.adminQuery<{ customers: { items: Array<{ id: string }> } }>(
    'FindCustomer',
    `query($email: String!) {
      customers(options: { filter: { emailAddress: { eq: $email } } }) { items { id } }
    }`,
    { email: person.email },
  );
  if (found.customers.items.length > 0) return found.customers.items[0].id;
  const created = await admin.adminMutation<{
    createCustomer: { id?: string; errorCode?: string; message?: string };
  }>(
    'CreateCustomer',
    `mutation($input: CreateCustomerInput!, $password: String) {
      createCustomer(input: $input, password: $password) {
        ... on Customer { id }
        ... on ErrorResult { errorCode message }
      }
    }`,
    {
      input: { firstName: person.firstName, lastName: person.lastName, emailAddress: person.email },
      password,
    },
  );
  if (!created.createCustomer.id) {
    throw new GraphQLFixtureError(
      `createCustomer for ${person.email} returned ${created.createCustomer.errorCode}: ` +
        `${created.createCustomer.message ?? 'no message'}`,
      'CreateCustomer',
    );
  }
  return created.createCustomer.id;
}

async function ensureInstructorProfile(
  admin: FixtureGraphQLClient,
  customerId: string,
  instructor: E2ETenantSpec['instructor'],
): Promise<string> {
  const listed = await admin.adminQuery<{
    instructorProfiles: { items: Array<{ id: string; slug: string }> };
  }>('InstructorProfiles', `{ instructorProfiles { items { id slug } } }`);
  const existing = listed.instructorProfiles.items.find(item => item.slug === instructor.slug);
  if (existing) return existing.id;
  const created = await admin.adminMutation<{ createInstructorProfile: { id: string } }>(
    'CreateInstructorProfile',
    `mutation($input: CreateInstructorProfileInput!) {
      createInstructorProfile(input: $input) { id }
    }`,
    {
      input: {
        customerId,
        slug: instructor.slug,
        fullName: instructor.fullName,
        isPublic: true,
        isActive: true,
      },
    },
  );
  return created.createInstructorProfile.id;
}

// ── BBB organization, membership, scheduled session ─────────────────────────

async function ensureOrganization(
  admin: FixtureGraphQLClient,
  channelId: string,
  spec: E2ETenantSpec,
): Promise<string> {
  const read = async (): Promise<Array<{ id: string; channelId: string }>> => {
    const data = await admin.adminQuery<{
      bbbOrganizations: { items: Array<{ id: string; channelId: string }> };
    }>('BbbOrganizations', `{ bbbOrganizations { items { id channelId } } }`);
    return data.bbbOrganizations.items.filter(item => item.channelId === channelId);
  };
  let rows = await read();
  if (rows.length === 0) {
    try {
      await admin.adminMutation(
        'CreateBbbOrganization',
        `mutation($input: CreateBbbOrganizationInput!) {
          createBbbOrganization(input: $input) { id }
        }`,
        { input: { channelId, slug: slugify(spec.businessName), name: spec.businessName } },
      );
    } catch (err) {
      // A listener may have auto-created it between read and write — re-read
      // before treating this as a failure (mirrors marketplace e2e ensureOrg).
      rows = await read();
      if (rows.length === 0) throw err;
    }
    rows = await read();
  }
  if (rows.length === 0) {
    throw new GraphQLFixtureError(
      `no BbbOrganization visible for channel ${channelId} on its own channel token`,
      'EnsureOrganization',
    );
  }
  return rows[0].id;
}

async function ensureMembership(
  admin: FixtureGraphQLClient,
  organizationId: string,
  customerId: string,
): Promise<void> {
  const listed = await admin.adminQuery<{
    bbbOrganizationMembers: { items: Array<{ id: string; customerId: string }> };
  }>(
    'BbbOrganizationMembers',
    `query($orgId: ID!) {
      bbbOrganizationMembers(organizationId: $orgId) { items { id customerId } }
    }`,
    { orgId: organizationId },
  );
  const already = listed.bbbOrganizationMembers.items.some(
    member => String(member.customerId) === String(customerId),
  );
  if (already) return;
  await admin.adminMutation(
    'AddBbbMember',
    `mutation($input: AddBbbMemberInput!) { addBbbMember(input: $input) { id customerId } }`,
    { input: { organizationId, customerId, role: 'org-admin' } },
  );
}

interface SessionRow {
  id: string;
  title: string;
  status: string;
}

async function ensureSession(
  admin: FixtureGraphQLClient,
  organizationId: string,
  trainerCustomerId: string,
  spec: E2ETenantSpec,
): Promise<SessionRow> {
  const listed = await admin.adminQuery<{ bbbScheduledSessions: SessionRow[] }>(
    'BbbScheduledSessions',
    `query($orgId: ID!) {
      bbbScheduledSessions(organizationId: $orgId) { id title status }
    }`,
    { orgId: organizationId },
  );
  const existing = listed.bbbScheduledSessions.find(
    session => session.title === spec.session.title,
  );
  if (existing) return existing;
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  const created = await admin.adminMutation<{ createBbbScheduledSession: SessionRow }>(
    'CreateBbbScheduledSession',
    `mutation($input: CreateBbbScheduledSessionInput!) {
      createBbbScheduledSession(input: $input) { id title status }
    }`,
    {
      input: {
        organizationId,
        title: spec.session.title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        trainerId: trainerCustomerId,
        subjectTags: spec.session.subjectTags,
        visibility: 'PUBLIC',
        isTrial: false,
      },
    },
  );
  return created.createBbbScheduledSession;
}

async function ensurePublishState(
  admin: FixtureGraphQLClient,
  session: SessionRow,
  expectedBbb: E2ETenantSpec['expected']['bbb'],
): Promise<string> {
  const finalStatus = (status: string): string => status;
  const status = session.status.toUpperCase();
  if (expectedBbb === 'scheduled_session') {
    if (status === 'DRAFT') {
      const published = await admin.adminMutation<{ publishBbbScheduledSession: { status: string } }>(
        'PublishBbbScheduledSession',
        `mutation($id: ID!) { publishBbbScheduledSession(id: $id) { id status } }`,
        { id: session.id },
      );
      return finalStatus(published.publishBbbScheduledSession.status);
    }
    if (status === 'SCHEDULED') return finalStatus(status);
    throw new GraphQLFixtureError(
      `session ${session.id} is '${session.status}' but expected.bbb='scheduled_session' ` +
        `requires DRAFT→SCHEDULED`,
      'EnsurePublishState',
    );
  }
  if (expectedBbb === 'no_session') {
    // A DRAFT row is neither scheduled nor live — §4's "no_session ⇒ neither"
    // reads FSM state, not table presence. Anything SCHEDULED/LIVE is drift.
    if (status === 'DRAFT') return finalStatus(status);
    throw new GraphQLFixtureError(
      `session ${session.id} is '${session.status}' but expected.bbb='no_session' requires ` +
        `neither SCHEDULED nor LIVE — manual cleanup needed`,
      'EnsurePublishState',
    );
  }
  throw new GraphQLFixtureError(
    `expected.bbb='${expectedBbb}' is not seedable by this seeder`,
    'EnsurePublishState',
  );
}

// ── orchestration ───────────────────────────────────────────────────────────

async function seedTenant(
  sa: FixtureGraphQLClient,
  spec: E2ETenantSpec,
  remembered: E2ETenantFixture | undefined,
): Promise<E2ETenantFixture> {
  let channel = await discoverChannel(sa, spec, remembered);
  if (!channel) {
    console.log(
      `[seed] ${spec.key}: channel not found — registering '${spec.businessName}' ` +
        `(registerNewTenant: 5/hour/IP rate limit applies)`,
    );
    await registerTenant(spec);
    channel = await discoverChannel(sa, spec, undefined);
    if (!channel) {
      throw new GraphQLFixtureError(
        `registration of ${spec.key} returned but channel '${slugify(spec.businessName)}-*' ` +
          `is not visible to SuperAdmin`,
        'SeedTenant',
      );
    }
  }

  const admin = await loginAdminOrVerify(spec);
  admin.withChannelToken(channel.token);

  const planId = await ensurePlan(sa, spec);

  // Registration auto-provisions the provider-free Free Basic row
  // (FreePlanProvisioningService); poll briefly in case the announce is
  // fire-and-forget rather than inline (same eventual pattern the
  // free-basic-activation script polls for capacity convergence).
  let current = await readSubscription(admin);
  for (let attempt = 0; current === null && attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    current = await readSubscription(admin);
  }
  await ensureSubscription(sa, channel.id, planId, spec.expected.subscription, current);

  const instructorCustomerId = await ensureCustomer(admin, spec.instructor, spec.instructor.password);
  const profileId = await ensureInstructorProfile(admin, instructorCustomerId, spec.instructor);
  const studentCustomerId = await ensureCustomer(admin, spec.student, spec.student.password);
  const organizationId = await ensureOrganization(admin, channel.id, spec);
  await ensureMembership(admin, organizationId, instructorCustomerId);
  const session = await ensureSession(admin, organizationId, instructorCustomerId, spec);
  const sessionStatus = await ensurePublishState(admin, session, spec.expected.bbb);

  console.log(
    `[seed] ${spec.key}: channel=${channel.id} plan=${planId} org=${organizationId} ` +
      `session=${session.id}(${sessionStatus}) profile=${profileId}`,
  );
  return {
    label: spec.label,
    channelId: channel.id,
    channelToken: channel.token,
    admin: { email: spec.admin.email, password: spec.admin.password },
    instructor: { customerId: instructorCustomerId, profileId },
    student: {
      customerId: studentCustomerId,
      email: spec.student.email,
      password: spec.student.password,
    },
    bbbOrganizationId: organizationId,
    planId,
    scheduledSessionId: session.id,
    sessionTitle: spec.session.title,
    expected: spec.expected,
  };
}

function loadManifest(): E2EFixtureManifest | null {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as E2EFixtureManifest;
  // Recorded ids are host-specific — a host change invalidates them.
  return parsed.host === HOST ? parsed : null;
}

async function main(): Promise<void> {
  const previous = loadManifest();
  const sa = await loginSuperAdmin(HOST);
  const manifest: E2EFixtureManifest = {
    createdAt: new Date().toISOString(),
    host: HOST,
    tenants: {},
  };
  for (const scenario of SCENARIOS) {
    console.log(`[seed] scenario '${scenario.name}': ${scenario.summary}`);
    for (const spec of scenario.tenants) {
      manifest.tenants[spec.key] = await seedTenant(sa, spec, previous?.tenants[spec.key]);
    }
  }
  // Marketplace axis: rebuild the index once every tenant exists so a
  // published listing is immediately searchable and an unpublished one is
  // provably absent. The resolver logs and returns false on failure.
  const reindex = await sa.adminQuery<{ marketplaceFullReindex: boolean }>(
    'MarketplaceFullReindex',
    `{ marketplaceFullReindex }`,
  );
  if (!reindex.marketplaceFullReindex) {
    throw new GraphQLFixtureError(
      'marketplaceFullReindex returned false — server logged the underlying error ' +
        '(Elasticsearch unreachable?)',
      'MarketplaceFullReindex',
    );
  }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[seed] manifest written: ${MANIFEST_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
