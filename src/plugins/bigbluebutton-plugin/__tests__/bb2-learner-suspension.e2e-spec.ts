/**
 * BB2 e2e — learner suspension is enforced at join time, not only at grant time.
 *
 * Install as: src/plugins/bigbluebutton-plugin/__tests__/bb2-learner-suspension.e2e-spec.ts
 * Run:        DB_PORT=6543 npx vitest run src/plugins/bigbluebutton-plugin/__tests__/bb2-learner-suspension.e2e-spec.ts
 *
 * Policy under test (BbbRoomAccessService.isLearnerBlocked):
 *   BLOCK  learner-facing access sources (entitlement / enrollment / session entitlement)
 *          when the learner's TenantLearnerMembership is SUSPENDED, REVOKED or LEFT.
 *   ALLOW  staff sources (org membership / moderator), PENDING learners, and learners
 *          with NO membership row (purchase flows, trial attendees).
 *
 * Status transitions (tenant-learner-membership.service.ts):
 *   ACTIVE → SUSPENDED → ACTIVE (activateTenantLearner)      ← suspension round trip
 *   ACTIVE/PENDING → REVOKED (terminal) → readmit → PENDING  ← NOT a suspension restore
 *
 * All state changes go through GraphQL. The only direct DB writes are the two personas
 * that cannot be created through the API (purchase entitlement with no membership row, and
 * an entitlement for a PENDING learner — createBbbEntitlement requires ACTIVE, H1/C-10) and
 * the BbbMeeting / BbbScheduledSession rows used for the getJoinUrl Path 2.
 *
 * Mutation check: make isLearnerBlocked() return false → every "denied" assertion here must
 * go red. Restore afterwards.
 */

import 'reflect-metadata';
import 'dotenv/config';
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
import { BbbEntitlement } from '../entities/bbb-entitlement.entity';
import { BbbMeeting } from '../entities/bbb-meeting.entity';
import { BbbScheduledSession } from '../entities/bbb-scheduled-session.entity';

registerInitializer('postgres', new SchemaPostgresInitializer());

// ─── GraphQL documents ─────────────────────────────────────────────────────

const REGISTER_CUSTOMER = gql`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    registerCustomerAccount(input: $input) {
      ... on Success { success }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const LOGIN = gql`
  mutation Login($emailAddress: String!, $password: String!) {
    login(username: $emailAddress, password: $password) {
      ... on CurrentUser { id identifier }
      ... on ErrorResult { errorCode message }
    }
  }
`;

const ACTIVE_CUSTOMER = gql`
  query ActiveCustomer { activeCustomer { id emailAddress } }
`;

const CREATE_BBB_ORGANIZATION = gql`
  mutation CreateBbbOrganization($input: CreateBbbOrganizationInput!) {
    createBbbOrganization(input: $input) { id channelId slug name }
  }
`;

const CREATE_BBB_ROOM = gql`
  mutation CreateBbbRoom($input: CreateBbbRoomInput!) {
    createBbbRoom(input: $input) { id name state }
  }
`;

const CREATE_BBB_ENROLLMENT = gql`
  mutation Bb2CreateEnrollment($input: CreateBbbEnrollmentInput!) {
    createBbbEnrollment(input: $input) { id roomId customerId active }
  }
`;

const CREATE_BBB_ENTITLEMENT = gql`
  mutation Bb2CreateEntitlement($input: CreateBbbEntitlementInput!) {
    createBbbEntitlement(input: $input) { id type resourceId customerId source validFrom validUntil }
  }
`;

const CREATE_BBB_ORG_MEMBERSHIP = gql`
  mutation Bb2CreateOrgMembership($input: CreateBbbOrgMembershipInput!) {
    createBbbOrgMembership(input: $input) { id role isActive }
  }
`;

const ADMIT_TENANT_LEARNER = gql`
  mutation Bb2Admit($input: AdmitTenantLearnerInput!) {
    admitTenantLearner(input: $input) { id status }
  }
`;

const ACTIVATE_TENANT_LEARNER = gql`
  mutation Bb2Activate($customerId: ID!) {
    activateTenantLearner(customerId: $customerId) { id status }
  }
`;

const SUSPEND_TENANT_LEARNER = gql`
  mutation Bb2Suspend($input: SuspendTenantLearnerInput!) {
    suspendTenantLearner(input: $input) { id status }
  }
`;

const REVOKE_TENANT_LEARNER = gql`
  mutation Bb2Revoke($input: RevokeTenantLearnerInput!) {
    revokeTenantLearner(input: $input) { id status }
  }
`;

const ROOM_STATUS = gql`
  query Bb2RoomStatus($id: ID!) { bbbRoomStatus(id: $id) { id state classAction } }
`;

const JOIN_ROOM = gql`
  mutation Bb2JoinRoom($roomId: ID!, $participantName: String!) {
    bbbJoinRoom(roomId: $roomId, participantName: $participantName) { status joinUrl }
  }
`;

const JOIN_MEETING = gql`
  mutation Bb2JoinMeeting($meetingId: ID!, $participantName: String!) {
    bbbJoinMeeting(meetingId: $meetingId, participantName: $participantName)
  }
`;

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('BB2: suspended learners are denied at join time', () => {
  const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
      apiOptions: { port: 0 },
      authOptions: { requireVerification: false },
      dbConnectionOptions: {
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? 'vendure',
        username: process.env.DB_USERNAME ?? 'vendure_user',
        password: process.env.DB_PASSWORD ?? '',
        schema: 'e2e_bb2_suspension',
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

  const PASSWORD = 'Bb2Suspend@1';
  const DENIED_PREVIEW = /not currently authorized to perform this action/i;
  const DENIED_JOIN = /do not have access/i;

  const decode = (id: unknown): string => String(id).replace(/^T_/, '');
  const encode = (id: unknown): string =>
    String(id).startsWith('T_') ? String(id) : `T_${id}`;
  const fail = (label: string, payload: unknown): never => {
    throw new Error(`${label}: ${JSON.stringify(payload)}`);
  };
  const rawConn = (): any => server.app.get(TransactionalConnection).rawConnection;
  const captureError = (p: Promise<unknown>): Promise<any> =>
    p.then(() => null, (e: unknown) => e);

  interface Learner { email: string; customerId: string }

  let channelId = '';
  let orgId = '';
  let roomMain = '';
  let roomStaff = '';
  let sessionId = '';
  let meetingId = '';

  let enrolled: Learner;
  let entitled: Learner;
  let revoked: Learner;
  let staff: Learner;
  let purchaser: Learner;
  let pending: Learner;
  let sessionLearner: Learner;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async function registerLearner(email: string): Promise<Learner> {
    await shopClient.asAnonymousUser();
    const reg: any = await shopClient.query(REGISTER_CUSTOMER, {
      input: {
        emailAddress: email,
        firstName: 'Bb2',
        lastName: 'Learner',
        password: PASSWORD,
      },
    });
    if (reg.registerCustomerAccount?.errorCode) fail('register', reg);
    const login: any = await shopClient.query(LOGIN, {
      emailAddress: email,
      password: PASSWORD,
    });
    if (login.login?.errorCode || !login.login?.id) fail('login', login);
    const me: any = await shopClient.query(ACTIVE_CUSTOMER);
    if (!me.activeCustomer?.id) fail('activeCustomer', me);
    return { email, customerId: decode(me.activeCustomer.id) };
  }

  async function admit(l: Learner, activate: boolean): Promise<void> {
    const a: any = await adminClient.query(ADMIT_TENANT_LEARNER, {
      input: { customerId: encode(l.customerId) },
    });
    if (!a.admitTenantLearner?.id) fail('admitTenantLearner', a);
    if (activate) await setStatus('activate', l);
  }

  async function setStatus(op: 'activate' | 'suspend' | 'revoke', l: Learner): Promise<void> {
    const customerId = encode(l.customerId);
    const res: any =
      op === 'activate'
        ? await adminClient.query(ACTIVATE_TENANT_LEARNER, { customerId })
        : op === 'suspend'
          ? await adminClient.query(SUSPEND_TENANT_LEARNER, {
              input: { customerId, reason: 'BB2 e2e' },
            })
          : await adminClient.query(REVOKE_TENANT_LEARNER, {
              input: { customerId, reason: 'BB2 e2e' },
            });
    const key = `${op}TenantLearner`;
    const expected = { activate: 'ACTIVE', suspend: 'SUSPENDED', revoke: 'REVOKED' }[op];
    if (res[key]?.status !== expected) fail(`${op} → ${expected}`, res);
  }

  const loginAs = (l: Learner) => shopClient.asUserWithCredentials(l.email, PASSWORD);

  async function meetingCount(roomIdRaw: string): Promise<number> {
    return rawConn().getRepository(BbbMeeting).count({ where: { roomId: roomIdRaw } });
  }

  async function expectDenied(l: Learner, room = roomMain): Promise<void> {
    await loginAs(l);
    const who: any = await shopClient.query(ACTIVE_CUSTOMER);
    expect(who.activeCustomer?.emailAddress).toBe(l.email);
    const previewErr = await captureError(
      shopClient.query(ROOM_STATUS, { id: encode(room) }),
    );
    expect(previewErr, 'preview must be refused').toBeTruthy();
    expect(String(previewErr?.message)).toMatch(DENIED_PREVIEW);
    const joinErr = await captureError(
      shopClient.query(JOIN_ROOM, { roomId: encode(room), participantName: 'Denied' }),
    );
    expect(joinErr, 'join must be refused').toBeTruthy();
    expect(String(joinErr?.message)).toMatch(DENIED_JOIN);
    expect(await meetingCount(room)).toBe(0);
  }

  async function expectAllowed(l: Learner, room = roomMain): Promise<void> {
    await loginAs(l);
    const preview: any = await shopClient.query(ROOM_STATUS, { id: encode(room) });
    expect(decode(preview.bbbRoomStatus.id)).toBe(room);
    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(room),
      participantName: 'Allowed',
    });
    expect(join.bbbJoinRoom.status).toBe('waiting_for_trainer');
    expect(await meetingCount(room)).toBe(0);
  }

  // ─── Fixtures ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await startOnFreePort({ server, adminClient, shopClient }, {
      initialData: E2E_INITIAL_DATA,
      customerCount: 0,
    });
    await adminClient.asSuperAdmin();
    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

    const stamp = Date.now();
    const ctx = await getSuperadminContext(server.app);
    channelId = String(ctx.channelId);

    const org: any = await adminClient.query(CREATE_BBB_ORGANIZATION, {
      input: {
        channelId,
        slug: `bb2-org-${stamp}`,
        name: `BB2 Org ${stamp}`,
        concurrentMeetingLimit: 5,
      },
    });
    if (!org.createBbbOrganization?.id) fail('createBbbOrganization', org);
    orgId = decode(org.createBbbOrganization.id);

    const mkRoom = async (name: string): Promise<string> => {
      const r: any = await adminClient.query(CREATE_BBB_ROOM, {
        input: {
          organizationId: encode(orgId),
          name: `${name} ${stamp}`,
          slug: `bb2-${name}-${stamp}`,
        },
      });
      if (!r.createBbbRoom?.id) fail(`createBbbRoom(${name})`, r);
      return decode(r.createBbbRoom.id);
    };
    roomMain = await mkRoom('main');
    roomStaff = await mkRoom('staff');

    enrolled = await registerLearner('enrolled');
    entitled = await registerLearner('entitled');
    revoked = await registerLearner('revoked');
    staff = await registerLearner('staff');
    purchaser = await registerLearner('purchaser');
    pending = await registerLearner('pending');
    sessionLearner = await registerLearner('session');

    for (const l of [enrolled, entitled, revoked, staff, sessionLearner]) await admit(l, true);
    await admit(pending, false);

    for (const l of [enrolled, revoked]) {
      const e: any = await adminClient.query(CREATE_BBB_ENROLLMENT, {
        input: {
          roomId: encode(roomMain),
          customerId: encode(l.customerId),
          accessDays: 30,
          reason: 'BB2',
        },
      });
      if (!e.createBbbEnrollment?.active) fail('createBbbEnrollment', e);
    }

    const ent: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
      input: {
        customerId: encode(entitled.customerId),
        type: 'bbb_room',
        resourceId: encode(roomMain),
      },
    });
    if (!ent.createBbbEntitlement?.id) fail('createBbbEntitlement', ent);

    const m: any = await adminClient.query(CREATE_BBB_ORG_MEMBERSHIP, {
      input: {
        organizationId: encode(orgId),
        customerId: encode(staff.customerId),
        channelId,
        role: 'org_admin',
      },
    });
    if (!m.createBbbOrgMembership?.id) fail('createBbbOrgMembership', m);

    const now = new Date();
    const startISO = new Date(now.getTime() + 3600000).toISOString();
    const endISO = new Date(now.getTime() + 7200000).toISOString();

    // Direct DB write for BbbScheduledSession (avoids GraphQL trainerId resolution)
    const sessionRepo = rawConn().getRepository(BbbScheduledSession);
    const session = await sessionRepo.save(
      sessionRepo.create({
        title: `BB2 Path 2 Session ${stamp}`,
        startTime: startISO,
        endTime: endISO,
        status: 'SCHEDULED',
        organization: { id: orgId },
      } as any),
    );
    sessionId = String((session as any).id);

    // Direct DB write for BbbMeeting linked to session as activeMeeting
    const meetingRepo = rawConn().getRepository(BbbMeeting);
    const meeting = await meetingRepo.save(
      meetingRepo.create({
        title: 'BB2 Path 2 active meeting',
        state: 'Active',
        bbbMeetingId: `bb2-meeting-path2-${stamp}`,
        organization: { id: orgId },
      } as any),
    );
    meetingId = String((meeting as any).id);

    // Link session to meeting as activeMeeting
    await sessionRepo.update(sessionId, { activeMeeting: { id: meetingId } as any });

    const sent: any = await adminClient.query(CREATE_BBB_ENTITLEMENT, {
      input: {
        customerId: encode(sessionLearner.customerId),
        type: 'bbb_session',
        resourceId: encode(sessionId),
      },
    });
    if (!sent.createBbbEntitlement?.id) fail('createBbbEntitlement(bbb_session)', sent);

    const entRepo = rawConn().getRepository(BbbEntitlement);
    for (const l of [purchaser, pending]) {
      await entRepo.save(
        entRepo.create({
          type: 'bbb_room',
          resourceId: roomMain,
          customerId: l.customerId,
          channelId,
          source: 'purchase',
          validFrom: null,
          validUntil: null,
        }),
      );
    }
  }, 240000);

  afterAll(async () => {
    await server.destroy();
  });

  // ─── Enrollment source ───────────────────────────────────────────────────

  it('enrollment learner: allowed while ACTIVE → denied when SUSPENDED → allowed again after activate', async () => {
    await expectAllowed(enrolled);
    await setStatus('suspend', enrolled);
    await expectDenied(enrolled);
    await setStatus('activate', enrolled);
    await expectAllowed(enrolled);
  });

  // ─── Entitlement source ──────────────────────────────────────────────────

  it('entitlement learner: allowed while ACTIVE → denied when SUSPENDED → allowed again after activate', async () => {
    await expectAllowed(entitled);
    await setStatus('suspend', entitled);
    await expectDenied(entitled);
    await setStatus('activate', entitled);
    await expectAllowed(entitled);
  });

  // ─── REVOKED ─────────────────────────────────────────────────────────────

  it('revoked learner is denied (REVOKED is terminal until readmit)', async () => {
    await expectAllowed(revoked);
    await setStatus('revoke', revoked);
    await expectDenied(revoked);
  });

  it.todo(
    'DECISION: readmit() puts a REVOKED/LEFT learner in PENDING, and PENDING is currently NOT blocked — ' +
      'so a readmitted learner regains rooms before activateTenantLearner. Decide, then pin it here.',
  );

  // ─── Staff control ───────────────────────────────────────────────────────

  it('staff who is also a SUSPENDED learner still gets in through the staff membership', async () => {
    await setStatus('suspend', staff);
    await loginAs(staff);
    const preview: any = await shopClient.query(ROOM_STATUS, { id: encode(roomStaff) });
    expect(decode(preview.bbbRoomStatus.id)).toBe(roomStaff);
    const join: any = await shopClient.query(JOIN_ROOM, {
      roomId: encode(roomStaff),
      participantName: 'Suspended Staff',
    });
    expect(['provisioning', 'active']).toContain(join.bbbJoinRoom.status);
  });

  // ─── Policy pins: who is deliberately NOT blocked ───────────────────────

  it('POLICY: a learner with NO membership row (purchase flow) is not blocked', async () => {
    await expectAllowed(purchaser);
  });

  it('POLICY: a PENDING learner is not blocked', async () => {
    await expectAllowed(pending);
  });

  // ─── getJoinUrl Path 2 (session entitlement) ─────────────────────────────

  it('getJoinUrl Path 2: session learner is refused when SUSPENDED and not refused otherwise', async () => {
    const attempt = async (): Promise<any> => {
      await loginAs(sessionLearner);
      return captureError(
        shopClient.query(JOIN_MEETING, { meetingId: encode(meetingId), participantName: 'Session' }),
      );
    };

    const before = await attempt();
    expect(String(before?.message ?? '')).not.toMatch(DENIED_PREVIEW);
    expect(String(before?.message ?? '')).not.toMatch(/do not have access to this meeting/i);

    await setStatus('suspend', sessionLearner);
    const during = await attempt();
    expect(during, 'suspended session learner must be refused').toBeTruthy();
    expect(String(during?.message)).toMatch(DENIED_PREVIEW);

    await setStatus('activate', sessionLearner);
    const after = await attempt();
    expect(String(after?.message ?? '')).not.toMatch(DENIED_PREVIEW);
    expect(String(after?.message ?? '')).not.toMatch(/do not have access to this meeting/i);
  });
});
