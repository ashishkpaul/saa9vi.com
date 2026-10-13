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
 *   C4 learner + Idle   → preview ✓, join `waiting_for_trainer` AND
 *                         requestProvisioning never called, zero BbbMeeting
 *                         rows, room row byte-identical (product invariant:
 *                         trainers start a class, learners only join one) —
 *                         then the SAME room starts fine for a moderator,
 *                         proving the fence is role-scoped and not a broken
 *                         room.
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import { BbbRoomService } from '../services/bbb-room.service';

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
      classAction
    }
  }
`;

/** Room list — must NOT claim an action it never computed. */
const MY_BBB_ROOMS = gql`
  query RoomAccessMyBbbRooms {
    myBbbRooms {
      id
      name
      state
      classAction
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
  /** Fresh Idle room used only by the learner-provisioning fence (C4). */
  let roomWaitId = '';
  /** Fresh room used to pin the server-driven classAction contract (C5). */
  let roomActionId = '';
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

    // C4 — a room that stays Idle until a MODERATOR starts it. The learner is
    // enrolled on it (authorized) so the only difference from C1 is the role.
    const waitRoom: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: encode(orgId),
        name: `INV-027 Wait Room ${stamp}`,
        slug: `inv027-room-wait-${stamp}`,
      },
    });
    if (!waitRoom.createBbbRoom?.id) {
      fail('createBbbRoom(wait)', waitRoom);
    }
    roomWaitId = decode(waitRoom.createBbbRoom.id);

    // C5 — a room whose state the test drives directly, so the four-valued
    // classAction contract can be pinned without a BBB server.
    const actionRoom: any = await adminClient.query(CREATE_BBB_ROOM, {
      input: {
        organizationId: encode(orgId),
        name: `INV-027 Action Room ${stamp}`,
        slug: `inv027-room-action-${stamp}`,
      },
    });
    if (!actionRoom.createBbbRoom?.id) {
      fail('createBbbRoom(action)', actionRoom);
    }
    roomActionId = decode(actionRoom.createBbbRoom.id);

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

    // Same learner on the C4 room — authorized (enrollment) but NOT a
    // moderator, so the fence below is the only thing that can stop her.
    const waitEnrollment: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: encode(roomWaitId),
        customerId: encode(enrolledCustomerId),
        accessDays: 30,
        reason: 'INV-027 C4 fixture',
      },
    });
    if (!waitEnrollment.createBbbEnrollment?.id) {
      fail('createBbbEnrollment(wait)', waitEnrollment);
    }
    expect(waitEnrollment.createBbbEnrollment.active).toBe(true);

    // Same learner on the C5 room — she must see WAIT / JOIN, never START.
    const actionEnrollment: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
      input: {
        roomId: encode(roomActionId),
        customerId: encode(enrolledCustomerId),
        accessDays: 30,
        reason: 'INV-027 C5 fixture',
      },
    });
    if (!actionEnrollment.createBbbEnrollment?.id) {
      fail('createBbbEnrollment(action)', actionEnrollment);
    }
    expect(actionEnrollment.createBbbEnrollment.active).toBe(true);

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

  it('C1 (enrollment only): preview succeeds AND join is honored — but as waiting_for_trainer', async () => {
    await shopClient.asUserWithCredentials(enrolledEmail, PASSWORD);

    const preview: any = await shopClient.query(ROOM_STATUS, {
      id: encode(roomEnrolledId),
    });
    expect(decode(preview.bbbRoomStatus.id)).toBe(roomEnrolledId);

    // Pre-INV-027 this threw "You do not have access to this room" because
    // join's Gate 3 read BbbEntitlement only — enrollment was authoritative
    // for display but decorative for the action that matters.
    //
    // Enrollment now DOES authorize the action — and because an enrollment is
    // a VIEWER source (isModerator=false) on a room nobody has started, the
    // answer is the terminal `waiting_for_trainer` rather than provisioning.
    // A ForbiddenError here would regress INV-027; a `provisioning` status
    // would regress "learners never provision".
    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(roomEnrolledId),
      participantName: 'Enrolled Learner',
    });
    expect(join.bbbJoinRoom.status).toBe('waiting_for_trainer');
    expect(join.bbbJoinRoom.joinUrl).toBeNull();
    // Authorization passed (no error) yet nothing was provisioned.
    expect(await meetingCountFor(roomEnrolledId)).toBe(0);
    expect(await roomState(roomEnrolledId)).toBe('Idle');
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
    //
    // C1 no longer provisions (the learner is fenced), so the room is still
    // Idle here: a MODERATOR is exactly who may start it, so join must take
    // the provisioning branch. The assertion is that NO access error is raised
    // and that the moderator — unlike the learner in C1 — actually provisions.
    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(roomEnrolledId),
      participantName: 'Org Admin',
    });
    expect(['provisioning', 'active']).toContain(join.bbbJoinRoom.status);
    expect(join.bbbJoinRoom.status).not.toBe('waiting_for_trainer');
    expect(await meetingCountFor(roomEnrolledId)).toBeGreaterThanOrEqual(1);
  });

  // ─── C4 — learner provisioning fence (product invariant) ──────────────────

  it('C4 (learner + Idle room): waiting_for_trainer with ZERO provisioning side effects', async () => {
    await shopClient.asUserWithCredentials(enrolledEmail, PASSWORD);

    // Preview must still authorize — the fence is about the ACTION, not access.
    const preview: any = await shopClient.query(ROOM_STATUS, {
      id: encode(roomWaitId),
    });
    expect(decode(preview.bbbRoomStatus.id)).toBe(roomWaitId);
    expect(preview.bbbRoomStatus.state).toBe('Idle');

    const roomBefore = await rawConn()
      .getRepository(BbbRoom)
      .findOne({ where: { id: roomWaitId } });
    expect(roomBefore).toBeTruthy();
    const meetingsBefore = await meetingCountFor(roomWaitId);
    expect(meetingsBefore).toBe(0);

    // Strongest form of "no provisioning": the boundary itself is never
    // entered — so no Redis lock, no Idle→Provisioning flip, no enqueue.
    const roomSvc = server.app.get(BbbRoomService);
    const spy = vi.spyOn(roomSvc, 'requestProvisioning');

    let join: any;
    let requestCalls = -1;
    try {
      join = await shopClient.query(JOIN_ROOM, {
        roomId: encode(roomWaitId),
        participantName: 'Waiting Learner',
      });
      requestCalls = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }

    expect(join.bbbJoinRoom.status).toBe('waiting_for_trainer');
    expect(join.bbbJoinRoom.joinUrl).toBeNull();
    expect(requestCalls).toBe(0);

    expect(await meetingCountFor(roomWaitId)).toBe(meetingsBefore);
    expect(await roomState(roomWaitId)).toBe('Idle');

    const roomAfter = await rawConn()
      .getRepository(BbbRoom)
      .findOne({ where: { id: roomWaitId } });
    expect(roomAfter).toBeTruthy();
    // The room row is untouched: state, optimistic-lock version, the active
    // meeting pointer, the debounce stamp and the retry budget all unchanged.
    expect(roomAfter!.version).toBe(roomBefore!.version);
    expect(roomAfter!.state).toBe(roomBefore!.state);
    expect(roomAfter!.currentMeetingId).toBe(roomBefore!.currentMeetingId);
    expect(roomAfter!.retryCount).toBe(roomBefore!.retryCount);
    expect(roomAfter!.lastProvisionRequestedAt?.getTime() ?? null).toBe(
      roomBefore!.lastProvisionRequestedAt?.getTime() ?? null,
    );
  }, 30000);

  it('C4b: the SAME room starts normally for a moderator (the fence is role-scoped)', async () => {
    await shopClient.asUserWithCredentials(staffEmail, PASSWORD);

    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(roomWaitId),
      participantName: 'Org Admin Starts',
    });
    // Not an access error, and not the learner's terminal answer.
    expect(['provisioning', 'active']).toContain(join.bbbJoinRoom.status);
    expect(join.bbbJoinRoom.status).not.toBe('waiting_for_trainer');
    expect(await meetingCountFor(roomWaitId)).toBeGreaterThanOrEqual(1);
    expect(await roomState(roomWaitId)).not.toBe('Idle');
  }, 30000);

  // ─── C5 — server-driven classAction (INV-008) ────────────────────────────

  it('C5: bbbRoomStatus exposes the four-valued classAction for every state/role pair', async () => {
    const setRoomState = async (state: string): Promise<void> => {
      await rawConn()
        .getRepository(BbbRoom)
        .update(roomActionId, { state: state as any });
    };
    const actionAs = async (email: string): Promise<string | null> => {
      await shopClient.asUserWithCredentials(email, PASSWORD);
      const res: any = await shopClient.query(ROOM_STATUS, {
        id: encode(roomActionId),
      });
      return res.bbbRoomStatus?.classAction ?? null;
    };

    // Idle — trainer STARTs it, learner WAITs for a trainer.
    await setRoomState('Idle');
    expect(await actionAs(enrolledEmail)).toBe('WAIT');
    expect(await actionAs(staffEmail)).toBe('START');

    // Provisioning — the split holds: a learner is never told to start it.
    await setRoomState('Provisioning');
    expect(await actionAs(enrolledEmail)).toBe('WAIT');
    expect(await actionAs(staffEmail)).toBe('START');

    // Active — everyone with access JOINS, learner and trainer alike.
    await setRoomState('Active');
    expect(await actionAs(enrolledEmail)).toBe('JOIN');
    expect(await actionAs(staffEmail)).toBe('JOIN');

    // Failed — no action for anyone; it needs an admin reset.
    await setRoomState('Failed');
    expect(await actionAs(enrolledEmail)).toBe('NONE');
    expect(await actionAs(staffEmail)).toBe('NONE');

    await setRoomState('Idle');
  }, 30000);

  it('C5b: myBbbRooms never claims an action it did not compute (classAction is null)', async () => {
    await shopClient.asUserWithCredentials(enrolledEmail, PASSWORD);
    const res: any = await shopClient.query(MY_BBB_ROOMS);
    const rooms: any[] = res.myBbbRooms ?? [];
    expect(rooms.length).toBeGreaterThan(0);
    for (const room of rooms) {
      // The list does not evaluate per-room access, so it must admit the
      // action is unknown rather than invent one.
      expect(room.classAction).toBeNull();
    }
  }, 30000);

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


