/**
 * ADR-047 / D5 — session ↔ room linkage.
 *
 * Phase 1 of `docs/implementation/bbb-attendee-hour-billing-plan.md` adds a
 * **nullable** `BbbScheduledSession.roomId` plus an optional `roomId` on the admin
 * create/update inputs, so the room-centric IA ("the room is the primary resource,
 * a session is a consequence of using it") can be built on top without a second
 * data model. This suite pins the rules that make the linkage safe:
 *
 *   1. A session may link a room of its **own** organization (persisted, echoed).
 *   2. A session may **not** link another tenant's room — the reference is rejected
 *      and no session row is written (INV-001 / INV-029: the owning organization is
 *      derived from authoritative state, never trusted from client input).
 *   3. `roomId: null` detaches; omitting the field leaves the existing link intact.
 *   4. Omitting `roomId` at create still produces the legacy room-less session
 *      (no backfill — §5 of the plan).
 *
 * Run:  npm run test:e2e:bbb-room-linkage
 *
 * Requires Postgres; credentials come from the same .env variables as the dev
 * server, and the run uses an isolated schema (`e2e_bbb_session_room`) so it never
 * touches dev/production data.
 */

import 'reflect-metadata';
import path from 'path';
import net from 'net';
import 'dotenv/config';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../../test-utils/free-port';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { verifyTenantAdminViaApi } from '../../tenant-plugin/e2e/fixtures/verify-tenant-admin';
import { BbbScheduledSession } from '../entities/bbb-scheduled-session.entity';

// ─── Postgres initializer — isolated schema ────────────────────────────────
registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL documents ─────────────────────────────────────────────────────

const REGISTER_NEW_TENANT = gql`
  mutation RegisterNewTenant($input: RegisterTenantInput!) {
    registerNewTenant(input: $input) {
      channelId
      channelToken
    }
  }
`;

const BBB_ORGANIZATIONS = gql`
  query BbbOrganizations {
    bbbOrganizations {
      items {
        id
        channelId
      }
      totalItems
    }
  }
`;

const CREATE_BBB_ROOM = gql`
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) {
      id
      name
      slug
    }
  }
`;

const CREATE_CUSTOMER = gql`
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) {
      ... on Customer {
        id
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const ADD_BBB_MEMBER = gql`
  mutation AddBbbMember($input: AddBbbMemberInput!) {
    addBbbMember(input: $input) {
      id
      customerId
      role
    }
  }
`;

const CREATE_SESSION = gql`
  mutation CreateSession($input: CreateBbbScheduledSessionInput!) {
    createBbbScheduledSession(input: $input) {
      id
      title
      status
      roomId
    }
  }
`;

const UPDATE_SESSION = gql`
  mutation UpdateSession($id: ID!, $input: UpdateBbbScheduledSessionInput!) {
    updateBbbScheduledSession(id: $id, input: $input) {
      id
      roomId
    }
  }
`;

const SESSION_BY_ID = gql`
  query SessionById($id: ID!) {
    bbbScheduledSession(id: $id) {
      id
      roomId
    }
  }
`;

// ─── Test suite ───────────────────────────────────────────────────────────

describe('BbbScheduledSession room linkage (ADR-047 / D5)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      // Free port assigned by startOnFreePort() in beforeAll (test-utils/free-port).
      apiOptions: { port: 0 },
      authOptions: {
        // Harness-created tenant admins are unverified — same rationale as
        // bbb-channel-isolation.e2e-spec.ts: login must not require verification.
        requireVerification: false,
      },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        // Isolated throwaway schema — never touches dev/production data.
        schema: 'e2e_bbb_session_room',
        synchronize: true,
      },
      plugins: [
        TenantPlugin,
        BigBlueButtonPlugin,
        CmsPlugin,
        ReviewsPlugin,
        SubscriptionPlugin.init({}) as any,
      ],
    }),
  );

  // ─── Shared state ─────────────────────────────────────────────────────────

  /** GraphQL ids arrive encoded (T_<id>); DB rows store the decoded form. */
  const decode = (id: unknown): string => String(id).replace(/^T_/, '');
  /** Re-encode a raw DB id for the GraphQL surface (TestingEntityIdStrategy). */
  const encode = (id: unknown): string =>
    String(id).startsWith('T_') ? String(id) : `T_${id}`;

  let emailA = '';
  let tokenA = '';
  let orgA = '';
  let emailB = '';
  let tokenB = '';
  let orgB = '';

  /** Tenant A rooms + the member id used as `trainerId`. */
  let roomA1 = '';
  let roomA2 = '';
  let trainerAMemberId = '';
  /** Tenant B's member id — must never be acceptable as tenant A's trainer. */
  let trainerBMemberId = '';
  /** Tenant B's room: must never be linkable from tenant A. */
  let roomB1 = '';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function fail(label: string, payload: unknown): never {
    throw new Error(`${label}: ${JSON.stringify(payload)}`);
  }

  function rawConn(): any {
    return server.app.get(TransactionalConnection).rawConnection;
  }

  /** Captures a rejection instead of failing the await. */
  async function captureError(promise: Promise<unknown>): Promise<any> {
    return promise.then(
      () => null,
      (e: unknown) => e,
    );
  }

  async function assertPostgres(): Promise<void> {
    const host = process.env.DB_HOST ?? 'localhost';
    const port = Number(process.env.DB_PORT ?? 5432);
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect(port, host);
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', (err) =>
        reject(
          new Error(
            `Postgres not reachable on ${host}:${port} — required by session-room-linkage.e2e-spec (${err.message})`,
          ),
        ),
      );
    });
  }

  /**
   * Authenticates first, then pins the channel token — the same order as
   * bbb-channel-isolation.e2e-spec.ts, because `setChannelToken` before login
   * leaves the admin client unauthorized.
   */
  async function loginTenantAdmin(email: string, token: string, password: string): Promise<void> {
    await adminClient.asUserWithCredentials(email, password);
    adminClient.setChannelToken(token);
  }

  /** The org is auto-provisioned by BbbTenantProvisioningListener (async). */
  async function orgIdForTenant(token: string): Promise<string> {
    adminClient.setChannelToken(token);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const { bbbOrganizations } = await adminClient.query(BBB_ORGANIZATIONS);
      if (bbbOrganizations.totalItems > 0) {
        // Exactly one org per tenant channel.
        expect(bbbOrganizations.totalItems).toBe(1);
        return bbbOrganizations.items[0].id as string;
      }
      if (Date.now() > deadline) fail('organization not provisioned', bbbOrganizations);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function createRoom(organizationId: string, name: string): Promise<string> {
    const res: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: { organizationId, name },
    });
    if (!res.createBbbRoom?.id) fail('createBbbRoom', res);
    return res.createBbbRoom.id as string;
  }

  /**
   * Creates a session for org A as the logged-in tenant A admin.
   * `roomId` is only sent when explicitly provided, so the "omitted" case is a
   * real omitted-field request rather than an explicit null.
   */
  async function createSession(
    organizationId: string,
    roomId?: string | null,
    /** `trainerId` in the one id space the service accepts: a member id. */
    trainerId: string = trainerAMemberId,
  ): Promise<any> {
    const input: Record<string, unknown> = {
      organizationId,
      title: `Room Link Session ${Date.now()}`,
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 90_000_000).toISOString(),
      trainerId,
    };
    if (roomId !== undefined) input.roomId = roomId;
    const res: any = await adminClient.query(CREATE_SESSION, { input });
    if (!res.createBbbScheduledSession?.id) fail('createBbbScheduledSession', res);
    return res.createBbbScheduledSession;
  }

  async function rawSession(id: string): Promise<BbbScheduledSession | null> {
    return rawConn()
      .getRepository(BbbScheduledSession)
      .findOne({ where: { id: decode(id) } });
  }

  async function sessionCountForOrg(organizationId: string): Promise<number> {
    return rawConn()
      .getRepository(BbbScheduledSession)
      .count({ where: { organizationId: decode(organizationId) } });
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await assertPostgres();
    await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      productsCsvPath: path.join(
        __dirname,
        '../../tenant-plugin/e2e/fixtures/e2e-products.csv',
      ),
      customerCount: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await server.destroy();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Two tenants — one org each (listener-provisioned)
  // ═══════════════════════════════════════════════════════════════════════

  it('registers two tenants and resolves their auto-provisioned organizations', async () => {
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

    emailA = `bbb-room-link-a-${Date.now()}@example.com`;
    const a: any = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'Room Link Academy A',
        firstName: 'A',
        lastName: 'Admin',
        emailAddress: emailA,
        password: 'StrongP@ss1',
        timezone: 'Asia/Kolkata',
      },
    });
    if (!a.registerNewTenant?.channelToken) fail('registerNewTenant(A)', a);
    tokenA = a.registerNewTenant.channelToken;
    await verifyTenantAdminViaApi(server, shopClient, emailA);

    emailB = `bbb-room-link-b-${Date.now()}@example.com`;
    const b: any = await shopClient.query(REGISTER_NEW_TENANT, {
      input: {
        businessName: 'Room Link Academy B',
        firstName: 'B',
        lastName: 'Admin',
        emailAddress: emailB,
        password: 'StrongP@ss2',
        timezone: 'Asia/Kolkata',
      },
    });
    if (!b.registerNewTenant?.channelToken) fail('registerNewTenant(B)', b);
    tokenB = b.registerNewTenant.channelToken;
    await verifyTenantAdminViaApi(server, shopClient, emailB);

    expect(tokenA).not.toEqual(tokenB);

    // Each tenant admin sees exactly its own channel's org (INV-001).
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');
    orgA = await orgIdForTenant(tokenA);

    await loginTenantAdmin(emailB, tokenB, 'StrongP@ss2');
    orgB = await orgIdForTenant(tokenB);

    expect(orgA).not.toEqual(orgB);
  }, 90_000);

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Rooms + a trainer member (used as the session's `trainerId`)
  // ═══════════════════════════════════════════════════════════════════════

  it('seeds two rooms for tenant A, one for tenant B, and a trainer member', async () => {
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');
    roomA1 = await createRoom(orgA, 'Room A1');
    roomA2 = await createRoom(orgA, 'Room A2');

    const customer: any = await adminClient.query(CREATE_CUSTOMER, {
      input: {
        firstName: 'Ada',
        lastName: 'Trainer',
        emailAddress: `room-link-trainer-${Date.now()}@example.com`,
      },
    });
    if (!customer.createCustomer?.id) fail('createCustomer', customer);

    const member: any = await adminClient.query(ADD_BBB_MEMBER, {
      input: {
        organizationId: orgA,
        customerId: customer.createCustomer.id,
        role: 'org-admin',
      },
    });
    if (!member.addBbbMember?.id) fail('addBbbMember', member);
    trainerAMemberId = member.addBbbMember.id;

    await loginTenantAdmin(emailB, tokenB, 'StrongP@ss2');
    roomB1 = await createRoom(orgB, 'Room B1');

    // Tenant B's own trainer member: the negative fixture proving that a
    // BbbOrganizationMember id is only valid inside ITS OWN organization.
    const customerB: any = await adminClient.query(CREATE_CUSTOMER, {
      input: {
        firstName: 'Bob',
        lastName: 'Trainer',
        emailAddress: `room-link-trainer-b-${Date.now()}@example.com`,
      },
    });
    if (!customerB.createCustomer?.id) fail('createCustomer B', customerB);
    const memberB: any = await adminClient.query(ADD_BBB_MEMBER, {
      input: {
        organizationId: orgB,
        customerId: customerB.createCustomer.id,
        role: 'org-admin',
      },
    });
    if (!memberB.addBbbMember?.id) fail('addBbbMember B', memberB);
    trainerBMemberId = memberB.addBbbMember.id;

    expect(roomA1).not.toEqual(roomA2);
    expect(roomB1).not.toEqual(roomA1);
  }, 90_000);

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Linkage rules
  // ═══════════════════════════════════════════════════════════════════════

  it('links a session to a room of its own organization', async () => {
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');

    const session = await createSession(orgA, roomA1);
    expect(session.roomId).toBe(encode(roomA1));

    // Persisted as the raw id, and readable through the tenant's own query.
    expect((await rawSession(session.id))?.roomId).toBe(decode(roomA1));
    const { bbbScheduledSession } = await adminClient.query(SESSION_BY_ID, {
      id: session.id,
    });
    expect(bbbScheduledSession.roomId).toBe(encode(roomA1));
  }, 60_000);

  it("refuses to link another tenant's room and writes no session row", async () => {
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');
    const before = await sessionCountForOrg(orgA);

    const err = await captureError(createSession(orgA, roomB1));

    // INV-001 / INV-029: the room is resolved inside the session's own
    // organization, so tenant B's room is simply not found — never linked,
    // and the surrounding transaction leaves no session behind.
    expect(err).not.toBeNull();
    expect(String(err?.message ?? err)).toMatch(/BbbRoom/);
    expect(await sessionCountForOrg(orgA)).toBe(before);
  }, 60_000);

  it("refuses another tenant's member id as the trainer, then accepts its own", async () => {
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');
    const before = await sessionCountForOrg(orgA);

    const err = await captureError(createSession(orgA, null, trainerBMemberId));

    // Trainer identity resolves in exactly ONE id space:
    // BbbOrganizationMember.id scoped to the session's OWN organization and
    // required to be active. Tenant B's member is simply not in that set, so a
    // foreign id is a hard not-found — never a silently-resolved foreign
    // trainer, and no session row is written.
    expect(err).not.toBeNull();
    expect(String(err?.message ?? err)).toMatch(/BbbOrganizationMember/);
    expect(await sessionCountForOrg(orgA)).toBe(before);

    // Positive control: the identical id space accepts tenant A's own member,
    // so the rejection above is about ownership — not a broken id form.
    const accepted = await createSession(orgA, undefined, trainerAMemberId);
    expect(accepted.id).toBeTruthy();
    expect(await sessionCountForOrg(orgA)).toBe(before + 1);
  }, 60_000);

  it('re-links to another room of the same org, then detaches with roomId: null', async () => {
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');
    const session = await createSession(orgA, roomA1);

    const relinked: any = await adminClient.query(UPDATE_SESSION, {
      id: session.id,
      input: { roomId: roomA2 },
    });
    expect(relinked.updateBbbScheduledSession.roomId).toBe(encode(roomA2));
    expect((await rawSession(session.id))?.roomId).toBe(decode(roomA2));

    const detached: any = await adminClient.query(UPDATE_SESSION, {
      id: session.id,
      input: { roomId: null },
    });
    expect(detached.updateBbbScheduledSession.roomId).toBeNull();
    expect((await rawSession(session.id))?.roomId).toBeNull();
  }, 60_000);

  it('keeps the legacy room-less session when roomId is omitted', async () => {
    await loginTenantAdmin(emailA, tokenA, 'StrongP@ss1');

    // Omitting roomId on create must not invent a link, and omitting it on
    // update must leave the stored link untouched (§5: no backfill, legacy
    // room-less sessions stay NULL).
    const session = await createSession(orgA);
    expect(session.roomId).toBeNull();
    expect((await rawSession(session.id))?.roomId).toBeNull();

    const updated: any = await adminClient.query(UPDATE_SESSION, {
      id: session.id,
      input: { title: 'Renamed with no room payload' },
    });
    expect(updated.updateBbbScheduledSession.roomId).toBeNull();
  }, 60_000);
});

