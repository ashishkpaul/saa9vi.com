import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  EventBus,
  Logger,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import {
  MeetingCompletedEvent,
  MeetingProvisionedEvent,
  SessionEndedEvent,
  SessionStartedEvent,
} from "../events/bbb-events";

const loggerCtx = "BbbSessionProvisioningListener";

/**
 * Transitions a scheduled session to LIVE only after its BBB meeting has been
 * successfully provisioned.
 *
 * The provisioning pipeline is asynchronous (meeting → BullMQ job → worker →
 * bbbApiService.createMeeting()), while `startScheduledSession` returns eagerly
 * and links a Pending meeting to the session. Marking the session LIVE in
 * startScheduledSession would create a race where learners see canJoin=true
 * before the BBB room actually exists.
 *
 * This listener is the single place a session becomes LIVE: it runs on
 * `MeetingProvisionedEvent`, which the single provisioning path
 * (`BbbMeetingService` → `BbbProvisioningWorkerService` → BBB API)
 * publishes only after the BBB createMeeting call succeeds.
 */
@Injectable()
export class BbbSessionProvisioningListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
    private readonly requestContextService: RequestContextService,
  ) {}

  onModuleInit(): void {
    this.eventBus
      .ofType(MeetingProvisionedEvent)
      .subscribe((event) => {
        this.handleMeetingProvisioned(event).catch((err) => {
          Logger.error(
            `Failed to transition linked session to LIVE for meeting ${event.meetingId}: ${(err as Error).message}`,
            loggerCtx,
          );
        });
      });

    // LIVE → FINISHED: when the linked meeting completes (webhook, admin
    // end-meeting, or reconciliation), the session must leave LIVE so
    // startScheduledSession and canJoin semantics remain correct.
    this.eventBus
      .ofType(MeetingCompletedEvent)
      .subscribe((event) => {
        this.handleMeetingCompleted(event).catch((err) => {
          Logger.error(
            `Failed to transition linked session to FINISHED for meeting ${event.meetingId}: ${(err as Error).message}`,
            loggerCtx,
          );
        });
      });

    // Startup repair: fix LIVE sessions whose linked meeting already completed
    // before this listener was registered (event-loss reconciliation).
    this.repairOrphanedLiveSessions().catch((err) => {
      Logger.error(
        `Startup session reconciliation failed: ${(err as Error).message}`,
        loggerCtx,
      );
    });
  }

  private async repairOrphanedLiveSessions(): Promise<void> {
    const ctx = await this.requestContextService.create({ apiType: "admin" });
    const repo = this.connection.getRepository(ctx, BbbScheduledSession);
    const stale = await repo.find({
      where: { status: "LIVE" },
      relations: ["activeMeeting"],
    });
    for (const session of stale) {
      if (!session.activeMeeting) continue;
      if (session.activeMeeting.state === "Completed") {
        session.status = "FINISHED";
        await repo.save(session);
        Logger.info(
          `Startup repair: Session ${session.id} → FINISHED (meeting ${session.activeMeeting.id} already completed)`,
          loggerCtx,
        );
      }
    }
  }

  private async handleMeetingProvisioned(
    event: MeetingProvisionedEvent,
  ): Promise<void> {
    const session = await this.connection
      .getRepository(event.ctx, BbbScheduledSession)
      .findOne({
        where: { activeMeeting: { id: event.meetingId } },
      });

    if (!session) {
      // Not every provisioned meeting is attached to a scheduled session
      // (e.g. room-based meetings). Nothing to transition.
      return;
    }

    if (session.status === "LIVE") {
      // Idempotent — a previous delivery (or a direct LIVE state) is fine.
      return;
    }

    session.status = "LIVE";
    const saved = await this.connection
      .getRepository(event.ctx, BbbScheduledSession)
      .save(session);

    this.eventBus.publish(
      new SessionStartedEvent(
        String(saved.id),
        saved.channelId ?? null,
      ),
    );

    Logger.info(
      `Session ${saved.id} → LIVE (meeting ${event.meetingId} provisioned)`,
      loggerCtx,
    );
  }

  private async handleMeetingCompleted(
    event: MeetingCompletedEvent,
  ): Promise<void> {
    const session = await this.connection
      .getRepository(event.ctx, BbbScheduledSession)
      .findOne({
        where: { activeMeeting: { id: event.meetingId } },
      });

    if (!session) {
      // Not every completed meeting is attached to a scheduled session.
      return;
    }

    if (session.status !== "LIVE") {
      // Idempotent — already FINISHED/CANCELLED/SCHEDULED.
      return;
    }

    session.status = "FINISHED";
    const saved = await this.connection
      .getRepository(event.ctx, BbbScheduledSession)
      .save(session);

    this.eventBus.publish(
      new SessionEndedEvent(String(saved.id), saved.channelId ?? null),
    );

    Logger.info(
      `Session ${saved.id} → FINISHED (meeting ${event.meetingId} completed via ${event.source})`,
      loggerCtx,
    );
  }
}