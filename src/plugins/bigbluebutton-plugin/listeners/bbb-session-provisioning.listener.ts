import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventBus, Logger, TransactionalConnection } from "@vendure/core";
import { BbbScheduledSession } from "../entities/bbb-scheduled-session.entity";
import {
  MeetingProvisionedEvent,
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
 * `MeetingProvisionedEvent`, which both provisioning paths (the dedicated
 * `BbbProvisioningWorkerService` queue processor and `BbbMeetingService`'s own
 * processor) publish only after the BBB createMeeting call succeeds.
 */
@Injectable()
export class BbbSessionProvisioningListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly connection: TransactionalConnection,
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
}