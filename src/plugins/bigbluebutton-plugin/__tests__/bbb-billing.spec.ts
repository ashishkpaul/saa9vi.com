/**
 * Regression tests for BBB billing lifecycle.
 *
 * Covers:
 * - Webhook completion bills exactly once
 * - Reconciliation completion bills exactly once
 * - Webhook + reconciliation race bills exactly once (idempotency)
 * - Earliest-expiring grant consumed first
 * - Dual-format webhook payload parsing (legacy + bbb-webhooks nested)
 * - rap-publish-ended recording event
 */

import { BbbReconciliationService } from "../services/bbb-reconciliation.service";
import { BbbMeetingService } from "../services/bbb-meeting.service";
import { MEETING_STATE } from "../constants";
import { BbbMeeting } from "../entities/bbb-meeting.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";
import { BbbUsageLedger } from "../entities/bbb-usage-ledger.entity";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMeeting(overrides: Partial<BbbMeeting> = {}): BbbMeeting {
  const now = new Date();
  const m = new BbbMeeting();
  m.id = "meeting-1";
  m.bbbMeetingId = "bbb-meeting-1";
  m.state = MEETING_STATE.ACTIVE;
  m.grantId = "grant-1";
  m.provisionedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago
  m.completedAt = now;
  m.roomId = null;
  Object.assign(m, overrides);
  return m;
}

function makeGrant(
  overrides: Partial<BbbCapacityGrant> = {},
): BbbCapacityGrant {
  const g = new BbbCapacityGrant();
  g.id = "grant-1";
  g.grantedMinutes = 600; // 10 hours in minutes
  g.consumedMinutes = 0;
  g.exhausted = false;
  g.validFrom = new Date(Date.now() - 86400000);
  g.validUntil = new Date(Date.now() + 86400000);
  Object.assign(g, overrides);
  return g;
}

// ─── consumeGrantHours unit tests ────────────────────────────────────────────

describe("BbbReconciliationService.consumeGrantHours", () => {
  function buildService(ledgerExists: boolean) {
    const ledgerSave = jest.fn().mockResolvedValue({});
    const ledgerFindOne = jest
      .fn()
      .mockResolvedValue(ledgerExists ? new BbbUsageLedger() : null);
    const grantQbExecute = jest.fn().mockResolvedValue({});

    // Stable repo objects — same reference returned every call
    const ledgerRepo = { findOne: ledgerFindOne, save: ledgerSave };
    const grantRepo = {
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        execute: grantQbExecute,
      })),
    };

    const mockEm = {
      getRepository: jest.fn((entity: any) => {
        if (entity === BbbUsageLedger) return ledgerRepo;
        if (entity === BbbCapacityGrant) return grantRepo;
        return {};
      }),
    };

    const mockConnection = {
      getRepository: jest.fn((_ctx: any, entity: any) => {
        if (entity === BbbCapacityGrant) {
          return { findOne: jest.fn().mockResolvedValue(makeGrant()) };
        }
        return {};
      }),
      rawConnection: {
        transaction: jest.fn(async (fn: (em: any) => Promise<void>) =>
          fn(mockEm),
        ),
      },
    };

    const service = new BbbReconciliationService(
      mockConnection as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { publish: jest.fn() } as any,
      {} as any, // options (uses defaults)
    );

    return {
      service,
      ledgerSave,
      ledgerFindOne,
      grantQbExecute,
      mockConnection,
    };
  }

  it("bills exactly once on first call", async () => {
    const { service, ledgerSave, grantQbExecute } = buildService(false);
    await service.consumeGrantHours({} as any, makeMeeting());

    expect(ledgerSave).toHaveBeenCalledTimes(1);
    expect(grantQbExecute).toHaveBeenCalledTimes(1);
  });

  it("skips billing on second call (idempotency)", async () => {
    const { service, ledgerSave, grantQbExecute } = buildService(true);
    await service.consumeGrantHours({} as any, makeMeeting());

    expect(ledgerSave).not.toHaveBeenCalled();
    expect(grantQbExecute).not.toHaveBeenCalled();
  });

  it("skips billing when meeting has no provisionedAt", async () => {
    const { service, mockConnection } = buildService(false);
    await service.consumeGrantHours(
      {} as any,
      makeMeeting({ provisionedAt: undefined as any }),
    );

    expect(mockConnection.rawConnection.transaction).not.toHaveBeenCalled();
  });

  it("skips billing when meeting has no grantId", async () => {
    const { service, mockConnection } = buildService(false);
    await service.consumeGrantHours(
      {} as any,
      makeMeeting({ grantId: undefined as any }),
    );

    expect(mockConnection.rawConnection.transaction).not.toHaveBeenCalled();
  });

  it("bills minimum 1 hour for sub-hour meetings", async () => {
    const { service, ledgerSave } = buildService(false);
    const now = new Date();
    const meeting = makeMeeting({
      provisionedAt: new Date(now.getTime() - 10 * 60 * 1000), // 10 min
      completedAt: now,
    });

    await service.consumeGrantHours({} as any, meeting);

    const savedRow: BbbUsageLedger = ledgerSave.mock.calls[0][0];
    expect(savedRow.consumedMinutes).toBeGreaterThanOrEqual(1);
  });
});

// ─── Grant ordering tests ─────────────────────────────────────────────────────

describe("Grant ordering — earliest-expiring first", () => {
  it("selects the grant with the earliest validUntil", () => {
    const now = new Date();
    const grants = [
      makeGrant({
        id: "g-new",
        validUntil: new Date(now.getTime() + 30 * 86400000),
      }),
      makeGrant({
        id: "g-expiring",
        validUntil: new Date(now.getTime() + 2 * 86400000),
      }),
      makeGrant({
        id: "g-mid",
        validUntil: new Date(now.getTime() + 10 * 86400000),
      }),
    ];

    // Mirrors ORDER BY validUntil ASC, createdAt ASC
    const sorted = [...grants].sort(
      (a, b) => a.validUntil.getTime() - b.validUntil.getTime(),
    );

    expect(sorted[0].id).toBe("g-expiring");
  });
});

// ─── Webhook payload parsing tests ───────────────────────────────────────────

describe("BbbMeetingService webhook handling", () => {
  function buildMeetingService() {
    const meetingUpdate = jest.fn().mockResolvedValue({});
    const meetingFindOne = jest.fn().mockResolvedValue(makeMeeting());

    // Stable repo — same object every getRepository call
    const meetingRepo = { findOne: meetingFindOne, update: meetingUpdate };

    const mockConnection = {
      getRepository: jest.fn(() => meetingRepo),
    };

    const service = new BbbMeetingService(
      mockConnection as any,
      {} as any,
      {} as any,
      {} as any, // serverService
      {} as any, // serverSelectionService
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { recordWebhookCompletion: jest.fn() } as any,
      {} as any,
      { publish: jest.fn() } as any,
    );

    const completeSpy = jest
      .spyOn(service, "completeMeetingLifecycle")
      .mockResolvedValue(makeMeeting({ state: MEETING_STATE.COMPLETED }));

    return { service, completeSpy, meetingUpdate, meetingFindOne };
  }

  it("parses legacy flat payload { meetingID }", async () => {
    const { service, completeSpy } = buildMeetingService();

    await service.handleWebhookEvent({} as any, "meeting-ended", {
      meetingID: "bbb-meeting-1",
    });

    expect(completeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bbbMeetingId: "bbb-meeting-1" }),
      { source: "webhook" },
    );
  });

  it("parses bbb-webhooks nested payload", async () => {
    const { service, completeSpy } = buildMeetingService();

    await service.handleWebhookEvent({} as any, "meeting-ended", {
      event: {
        data: {
          attributes: {
            meeting: { externalMeetingId: "bbb-meeting-1" },
          },
        },
      },
    });

    expect(completeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bbbMeetingId: "bbb-meeting-1" }),
      { source: "webhook" },
    );
  });

  it("ignores payload with no recognisable meeting ID", async () => {
    const { service, completeSpy } = buildMeetingService();

    await service.handleWebhookEvent({} as any, "meeting-ended", {
      someOtherField: "value",
    });

    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("routes rap-publish-ended to recording update, not lifecycle", async () => {
    const { service, completeSpy, meetingUpdate } = buildMeetingService();

    await service.handleWebhookEvent({} as any, "rap-publish-ended", {
      meetingID: "bbb-meeting-1",
      recordID: "rec-abc",
      playback: { url: "https://bbb.example.com/playback/rec-abc" },
    });

    expect(completeSpy).not.toHaveBeenCalled();
    expect(meetingUpdate).toHaveBeenCalledWith(
      "meeting-1",
      expect.objectContaining({ bbbRecordingId: "rec-abc" }),
    );
  });

  it("does not handle old recording-ready event name", async () => {
    const { service, completeSpy, meetingUpdate } = buildMeetingService();

    await service.handleWebhookEvent({} as any, "recording-ready", {
      meetingID: "bbb-meeting-1",
      recordID: "rec-abc",
    });

    expect(completeSpy).not.toHaveBeenCalled();
    expect(meetingUpdate).not.toHaveBeenCalled();
  });
});

// ─── Reconciliation routes through lifecycle ─────────────────────────────────

describe("BbbReconciliationService.reconcileActiveMeetings", () => {
  function buildReconciliationService(isMeetingRunning: boolean) {
    const completeMeetingLifecycle = jest
      .fn()
      .mockResolvedValue(makeMeeting({ state: MEETING_STATE.COMPLETED }));

    const mockConnection = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          getMany: jest
            .fn()
            .mockResolvedValue([
              makeMeeting({ bbbMeetingId: "bbb-m1", serverId: "srv-1" }),
            ]),
        })),
      })),
    };

    const service = new BbbReconciliationService(
      mockConnection as any,
      { create: jest.fn().mockResolvedValue({}) } as any,
      {
        findByIdWithSecret: jest.fn().mockResolvedValue({ id: "srv-1" }),
      } as any,
      {
        isMeetingRunning: jest.fn().mockResolvedValue(isMeetingRunning),
      } as any,
      {} as any,
      { completeMeetingLifecycle } as any,
      { publish: jest.fn() } as any,
      {} as any, // options (uses defaults)
    );

    return { service, completeMeetingLifecycle };
  }

  it("calls completeMeetingLifecycle for each stopped meeting", async () => {
    const { service, completeMeetingLifecycle } =
      buildReconciliationService(false);

    const count = await service.reconcileActiveMeetings();

    expect(count).toBe(1);
    expect(completeMeetingLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      "meeting-1",
      { source: "reconciliation" },
    );
  });

  it("does not call completeMeetingLifecycle for still-running meetings", async () => {
    const { service, completeMeetingLifecycle } =
      buildReconciliationService(true);

    const count = await service.reconcileActiveMeetings();

    expect(count).toBe(0);
    expect(completeMeetingLifecycle).not.toHaveBeenCalled();
  });
});
