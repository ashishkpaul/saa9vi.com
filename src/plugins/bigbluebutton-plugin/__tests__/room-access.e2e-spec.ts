/**
 * INV-027 (BUG-045) e2e — room preview (`bbbRoomStatus`) and room join
 * (`bbbJoinRoom`) evaluate the SAME authorization sources, and join
 * authorizes BEFORE provisioning.
 *
 * Three personas over one BbbOrganization, each asserting BOTH surfaces:
 *   C1 enrollment-only  → preview ✓, join ✓ (pre-INV-027: join threw
 *                         "You do not have access" — BbbEnrollment was
 *                         authoritative for display but not for the action)
 *   C2 membership staff → preview ✓, join ✓ (pre-INV-027: preview returned
 *                         ForbiddenError — BbbOrganizationMembership was
 *                         checked by join but invisible to the preview)
 *   C3 no access        → preview ✗, join ✗ AND zero BbbMeeting rows /
 *                         room still Idle (join authorizes BEFORE
 *                         requestProvisioning — the ordering defect)
 *
 * Also asserts BUG-044: `createBbbCapacityGrant` persists
 * `sourceType='manual'` (not the `'order'` column default) and the Admin
 * `bbbCapacityGrants` query exposes it.
 *
 * Run:  npm run test:e2e:room-access
 *
 * Requires a running Postgres (same .env as the dev server). Isolated schema
 * `e2e_room_access` — never touches dev/production data (`synchronize` here is
 * the established e2e carve-out used by r4-runtime-lifecycle.e2e-spec.ts).
 *
 * The test harness loads no DefaultJobQueuePlugin, so the provisioning queue
 * never starts (the same condition r4's "drive provisioning directly" fallback
 * documents): an authorized join deterministically creates one PENDING
 * BbbMeeting and returns status='provisioning' with NO BBB network traffic,
 * while a denied join must create nothing at all.
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import gql from 'graphql-tag';
import {
  createTestEnvironment,
  E2E_DEFAULT_CHANNEL_TOKEN,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { startOnFreePort } from '../../../test-utils/free-port';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { BigBlueButtonPlugin } from '../bigbluebutton.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { ReviewsPlugin } from '../../reviews/reviews-plugin';
import { SubscriptionPlugin } from '../../subscription/subscription.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { E2E_INITIAL_DATA } from '../../tenant-plugin/e2e/fixtures/e2e-initial-data';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbRoom } from '../entities/bbb-room.entity';
import { BbbCapacityGrant } from '../entities/bbb-capacity-grant.entity';
import { BbbRoomAccessService } from '../services/room-access.service';

registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL documents ─────────────────────────────────────────────────────

const REGISTER_CUSTOMER = gql`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    registerCustomerAccount(input: $input) {
      ... on Success {
        success
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const LOGIN = gql`
  mutation Login($emailAddress: String!, $password: String!) {
    login(username: $emailAddress, password: $password) {
      ... on CurrentUser {
        id
        identifier
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

const ACTIVE_CUSTOMER = gql`
  query RoomAccessActiveCustomer {
    activeCustomer {
      id
      emailAddress
    }
  }
`;

const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) {
      id
      channelId
      slug
      name
    }
  }
`;

const CREATE_BBB_ROOM = gql`
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) {
      id
      name
      slug
      state
    }
  }
`;

const CREATE_BBB_ENROLLMENT = gql`
  mutation CreateBbbEnrollment($input: CreateBbbEnrollmentInput!) {
    createBbbEnrollment(input: $input) {
      id
      roomId
      customerId
      active
      expiresAt
      source
    }
  }
`;

const CREATE_BBB_ORG_MEMBERSHIP = gql`
  mutation CreateBbbOrgMembership($input: CreateBbbOrgMembershipInput!) {
    createBbbOrgMembership(input: $input) {
      id
      organizationId
      customerId
      role
      isActive
    }
  }
`;

const CREATE_BBB_CAPACITY_GRANT = gql`
  mutation CreateBbbCapacityGrant($input: CreateBbbCapacityGrantInput!) {
    createBbbCapacityGrant(input: $input) {
      id
      sourceType
      grantedMinutes
      orderId
    }
  }
`;

const LIST_BBB_CAPACITY_GRANTS = gql`
  query ListBbbCapacityGrants($organizationId: ID!) {
    bbbCapacityGrants(organizationId: $organizationId) {
      items {
        id
        sourceType
        grantedMinutes
        orderId
      }
      totalItems
    }
  }
`;

/** Preview surface — must decide EXACTLY like join (INV-027). */
const ROOM_STATUS = gql`
  query RoomAccessRoomStatus($id: ID!) {
    bbbRoomStatus(id: $id) {
      id
      name
      state
    }
  }
`;

/** Action surface — must decide EXACTLY like preview (INV-027). */
const JOIN_ROOM = gql`
  mutation RoomAccessJoinRoom($roomId: ID!, $participantName: String!) {
    bbbJoinRoom(roomId: $roomId, participantName: $participantName) {
      status
      joinUrl
    }
  }
`;

// ─── Test suite ────────────────────────────────────────────────────────────

describe('INV-027 room preview/join parity (BUG-045)', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      // Free port assigned by startOnFreePort() in beforeAll (test-utils/free-port).
      apiOptions: { port: 0 },
      authOptions: {
        // Same rationale as bbb-channel-isolation: harness-created accounts
        // are unverified, so login must not require verification here.
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
        schema: 'e2e_room_access',
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

  // ─── Shared state (raw/decoded ids; GraphQL responses arrive T_-encoded) ──
  let channelId = '';
  let orgId = '';
  /** Room used by the enrollment persona (C1) and the staff persona (C2). */
  let roomEnrolledId = '';
  /** Fresh room used only by the denied persona (C3). */
  let roomDeniedId = '';
  /** C1: BbbEnrollment only — no membership, no entitlement. */
  let enrolledCustomerId = '';
  /** C2: BbbOrganizationMembership(org_admin) only. */
  let staffCustomerId = '';
  /** C3: no source row of any kind. */
  let outsiderCustomerId = '';
  let manualGrantId = '';

  const PASSWORD = 'RoomAccess@1';
  let enrolledEmail = '';
  let staffEmail = '';
  let outsiderEmail = '';

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** GraphQL ids arrive encoded (T_<id>); raw DB rows use the decoded form. */
  const decode = (id: unknown): string => String(id).replace(/^T_/, '');

  /** Re-encode a raw DB id for the GraphQL surface (TestingEntityIdStrategy). */
  const encode = (id: unknown): string =>
    String(id).startsWith('T_') ? String(id) : `T_${id}`;

  function fail(label: string, payload: unknown): never {
    throw new Error(`${label}: ${JSON.stringify(payload)}`);
  }

  function rawConn(): any {
    return server.app.get(TransactionalConnection).rawConnection;
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
            `Postgres not reachable on ${host}:${port} — required by room-access.e2e-spec (${err.message})`,
          ),
        ),
      );
    });
  }

  /** Registers + logs in on the default channel; returns the RAW customer id. */
  async function registerAndLoginCustomer(
    email: string,
    password: string,
  ): Promise<string> {
    await shopClient.asAnonymousUser();
    const reg: any = await shopClient.query(REGISTER_CUSTOMER, {
      input: {
        emailAddress: email,
        firstName: 'Room',
        lastName: 'Access',
        password,
      },
    });
    if (reg.registerCustomerAccount?.errorCode) {
      fail('registerCustomerAccount', reg.registerCustomerAccount);
    }
    const login: any = await shopClient.query(LOGIN, {
      emailAddress: email,
      password,
    });
    if (login.login?.errorCode || !login.login?.id) {
      fail('login', login.login);
    }
    const me: any = await shopClient.query(ACTIVE_CUSTOMER);
    if (!me.activeCustomer?.id) fail('activeCustomer', me);
    return decode(me.activeCustomer.id);
  }

  async function meetingCountFor(roomIdRaw: string): Promise<number> {
    return rawConn()
      .getRepository(BbbMeeting)
      .count({ where: { roomId: roomIdRaw } });
  }

  async function roomState(roomIdRaw: string): Promise<string | null> {
    const room = await rawConn()
      .getRepository(BbbRoom)
      .findOne({ where: { id: roomIdRaw } });
    return room?.state ?? null;
  }

  /** Captures a GraphQL rejection instead of failing the await. */
  async function captureError(promise: Promise<unknown>): Promise<any> {
    return promise.then(
      () => null,
      (e: unknown) => e,
    );
  }


  // ─── Fixture bootstrap ───────────────────────────────────────────────────

  beforeAll(async () => {
    await assertPostgres();
    await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      customerCount: 0,
    });

    await adminClient.asSuperAdmin();
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

    const stamp = Date.now();
    const ctx = await getSuperadminContext(server.app);
    channelId = String(ctx.channelId);

    const org: any = await adminClient.query(CREATE_BBB_ORGANIZATION, {
      input: {
        channelId,
        slug: `inv027-org-${stamp}`,
        name: `INV-027 Org ${stamp}`,
        concurrentMeetingLimit: 5,
      },
    });
    if (!org.createBbbOrganization?.id) {
      fail('createBbbOrganization', org);
    }
    orgId = decode(org.createBbbOrganization.id);

    const enrolledRoom: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: encode(orgId),
        name: `INV-027 Enrolled Room ${stamp}`,
        slug: `inv027-room-enrolled-${stamp}`,
      },
    });
    if (!enrolledRoom.createBbbRoom?.id) {
      fail('createBbbRoom(enrolled)', enrolledRoom);
    }
    roomEnrolledId = decode(enrolledRoom.createBbbRoom.id);

    const deniedRoom: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: encode(orgId),
        name: `INV-027 Denied Room ${stamp}`,
        slug: `inv027-room-denied-${stamp}`,
      },
    });
    if (!deniedRoom.createBbbRoom?.id) {
      fail('createBbbRoom(denied)', deniedRoom);
    }
    roomDeniedId = decode(deniedRoom.createBbbRoom.id);

    enrolledEmail = `inv027-enrolled-${stamp}@example.com`;
    staffEmail = `inv027-staff-${stamp}@example.com`;
    outsiderEmail = `inv027-outsider-${stamp}@example.com`;
    enrolledCustomerId = await registerAndLoginCustomer(
      enrolledEmail,
      PASSWORD,
    );
    staffCustomerId = await registerAndLoginCustomer(staffEmail, PASSWORD);
    outsiderCustomerId = await registerAndLoginCustomer(
      outsiderEmail,
      PASSWORD,
    );

    // C1 — enrollment only (the admin EnrollmentsList → createBbbEnrollment
    // path, the only remaining BbbEnrollment writer).
    const enrollment: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: encode(roomEnrolledId),
        customerId: encode(enrolledCustomerId),
        accessDays: 30,
        reason: 'INV-027 fixture',
      },
    });
    if (!enrollment.createBbbEnrollment?.id) {
      fail('createBbbEnrollment', enrollment);
    }
    expect(enrollment.createBbbEnrollment.active).toBe(true);

    // C2 — FEAT-001 org membership only (org_admin ⇒ moderator role).
    const membership: any = await adminClient.query(
      CREATE_BBB_ORG_MEMBERSHIP,
      {
        input: {
          organizationId: encode(orgId),
          customerId: encode(staffCustomerId),
          channelId,
          role: 'org_admin',
        },
      },
    );
    if (!membership.createBbbOrgMembership?.id) {
      fail('createBbbOrgMembership', membership);
    }
    expect(membership.createBbbOrgMembership.isActive).toBe(true);

    // BUG-044 fixture: manual admin override grant for the same org.
    const grant: any = await adminClient.query(CREATE_BBB_CAPACITY_GRANT, {
      input: {
        organizationId: encode(orgId),
        grantedMinutes: 120,
      },
    });
    if (!grant.createBbbCapacityGrant?.id) {
      fail('createBbbCapacityGrant', grant);
    }
    manualGrantId = decode(grant.createBbbCapacityGrant.id);
  }, 180_000);

  afterAll(async () => {
    await server.destroy();
  });


  // ─── BUG-044 — manual grants persist sourceType='manual' ─────────────────

  it('BUG-044: createBbbCapacityGrant persists sourceType="manual" and the Admin query exposes it', async () => {
    const raw = await rawConn()
      .getRepository(BbbCapacityGrant)
      .findOne({ where: { id: manualGrantId } });
    expect(raw).toBeTruthy();
    expect(raw.sourceType).toBe('manual');
    // The BUG-044 corruption signature: manual overrides carry NO order
    // linkage and must not masquerade as a purchase row.
    expect(raw.orderId).toBeNull();

    const listed: any = await adminClient.query(LIST_BBB_CAPACITY_GRANTS, {
      organizationId: encode(orgId),
    });
    const items: any[] = listed.bbbCapacityGrants?.items ?? [];
    const manual = items.find((g) => decode(g.id) === manualGrantId);
    expect(manual).toBeTruthy();
    expect(manual.sourceType).toBe('manual');
    // The org also auto-provisions its internal_overhead grant (FEAT-002);
    // it must be distinguishable from the admin override by sourceType.
    const overhead = items.find((g) => g.sourceType === 'internal_overhead');
    expect(overhead).toBeTruthy();
  });

  // ─── C3 — denied persona: both surfaces refuse, nothing provisioned ──────

  it('C3 (no access): preview is Forbidden, join is refused BEFORE provisioning', async () => {
    await shopClient.asUserWithCredentials(outsiderEmail, PASSWORD);

    // Prove the session IS authenticated first: Vendure's ForbiddenError
    // (i18n key error.forbidden) resolves to the SAME string the
    // @Allow(Authenticated) gate emits ("not currently authorized"), so the
    // message alone can't tell "INV-027 evaluation denied" apart from
    // "anonymous caller" (the R4-07 lesson). With a verified session, the
    // preview denial can only come from bbbRoomStatus's access evaluation.
    const who: any = await shopClient.query(ACTIVE_CUSTOMER);
    expect(who.activeCustomer?.emailAddress).toBe(outsiderEmail);

    const previewErr = await captureError(
      shopClient.query(ROOM_STATUS, { id: encode(roomDeniedId) }),
    );
    expect(previewErr).toBeTruthy();
    // i18n `error.forbidden` — the resolver's `throw new ForbiddenError()`
    // after `evaluate()` returned allowed:false (en.json:37).
    expect(String(previewErr?.message)).toMatch(
      /not currently authorized to perform this action/i,
    );

    expect(await meetingCountFor(roomDeniedId)).toBe(0);

    const joinErr = await captureError(
      shopClient.query(JOIN_ROOM, {
        roomId: encode(roomDeniedId),
        participantName: 'Denied Outsider',
      }),
    );
    expect(joinErr).toBeTruthy();
    expect(String(joinErr?.message)).toMatch(/do not have access/i);

    // The ordering defect (BUG-045 #3): pre-INV-027 joinRoom called
    // requestProvisioning BEFORE any gate, so a denied customer still spun
    // up a meeting. Authorization now runs first — prove it stayed that way.
    expect(await meetingCountFor(roomDeniedId)).toBe(0);
    expect(await roomState(roomDeniedId)).toBe('Idle');
  });

  // ─── C1 — enrollment persona: preview ✓ and join ✓ ───────────────────────

  it('C1 (enrollment only): preview succeeds AND join succeeds (enrollment honored at join time)', async () => {
    await shopClient.asUserWithCredentials(enrolledEmail, PASSWORD);

    const preview: any = await shopClient.query(ROOM_STATUS, {
      id: encode(roomEnrolledId),
    });
    expect(decode(preview.bbbRoomStatus.id)).toBe(roomEnrolledId);

    // Pre-INV-027 this threw "You do not have access to this room" because
    // join's Gate 3 read BbbEntitlement only — enrollment was authoritative
    // for display but decorative for the action that matters.
    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(roomEnrolledId),
      participantName: 'Enrolled Learner',
    });
    expect(join.bbbJoinRoom.status).toBe('provisioning');
    // Authorization passed ⇒ at least one meeting was created for the room.
    expect(await meetingCountFor(roomEnrolledId)).toBeGreaterThanOrEqual(1);
  });

  // ─── C2 — staff persona: preview ✓ (was Forbidden) and join ✓ ────────────

  it('C2 (org_admin membership): preview succeeds (was Forbidden pre-INV-027) AND join succeeds', async () => {
    await shopClient.asUserWithCredentials(staffEmail, PASSWORD);

    const preview: any = await shopClient.query(ROOM_STATUS, {
      id: encode(roomEnrolledId),
    });
    expect(decode(preview.bbbRoomStatus.id)).toBe(roomEnrolledId);

    // Pre-INV-027 bbbRoomStatus never consulted BbbOrganizationMembership,
    // so FEAT-001 staff who passed join's Gate 1 got ForbiddenError here.
    // The room is already Provisioning from C1, so join must fast-exit with
    // 'provisioning' — the assertion is that NO access error is raised.
    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(roomEnrolledId),
      participantName: 'Org Admin',
    });
    expect(['provisioning', 'active']).toContain(join.bbbJoinRoom.status);
  });

  // ─── The single shared evaluation (INV-027) ──────────────────────────────

  it('shared evaluator: same three personas, one decision each — including moderator role', async () => {
    const evaluator = server.app.get(BbbRoomAccessService);
    const ctx = await getSuperadminContext(server.app);

    // C1 — purchase/admin sources are VIEWER-class: allowed, never moderator.
    expect(
      await evaluator.evaluate(
        ctx,
        enrolledCustomerId,
        orgId,
        roomEnrolledId,
      ),
    ).toEqual({ allowed: true, isModerator: false, source: 'enrollment' });

    // C2 — staff sources carry the BBB role: org_admin ⇒ moderator.
    expect(
      await evaluator.evaluate(ctx, staffCustomerId, orgId, roomEnrolledId),
    ).toEqual({ allowed: true, isModerator: true, source: 'membership' });

    // C3 — no source row anywhere ⇒ denied by the ONE evaluation both
    // surfaces call, which is exactly what makes preview denial ⇔ join denial.
    expect(
      await evaluator.evaluate(ctx, outsiderCustomerId, orgId, roomEnrolledId),
    ).toEqual({ allowed: false, isModerator: false, source: null });
  });
});


