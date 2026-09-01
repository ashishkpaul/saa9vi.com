import { RequestContext, VendureEvent } from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";

/**
 * Session lifecycle events (Gate 1.4 / F5 projection completeness).
 *
 * These are state-transition signals, not mutation notifications: the
 * marketplace projection contract (phase3-audit.md field→event matrix)
 * cares about *eligibility transitions* (PUBLIC/PRIVATE, SCHEDULED/LIVE/
 * FINISHED/CANCELLED), and every consumer funnels through the guarded
 * `MarketplaceIndexerService.indexSession()` which owns the eligibility rule.
 */
export class SessionCreatedEvent extends VendureEvent {
  constructor(public readonly sessionId: string, public readonly channelId: string | null) {
    super();
  }
}

export class SessionUpdatedEvent extends VendureEvent {
  constructor(public readonly sessionId: string, public readonly channelId: string | null) {
    super();
  }
}

export class SessionCancelledEvent extends VendureEvent {
  constructor(public readonly sessionId: string, public readonly channelId: string | null) {
    super();
  }
}

export class SessionStartedEvent extends VendureEvent {
  constructor(public readonly sessionId: string, public readonly channelId: string | null) {
    super();
  }
}

export class MeetingProvisionedEvent extends VendureEvent {
  constructor(
    public readonly meetingId: string,
    public readonly bbbMeetingId: string,
    public readonly roomId: string | null,
    public readonly organizationId: string,
    public readonly grantId: string,
  ) {
    super();
  }
}

export class MeetingCompletedEvent extends VendureEvent {
  constructor(
    public readonly meetingId: string,
    public readonly roomId: string | null,
    public readonly organizationId: string,
    public readonly source:
      | "webhook"
      | "end-meeting"
      | "reconciliation"
      | "stale-active-runtime"
      | "manual",
    public readonly consumedHours: number,
  ) {
    super();
  }
}

export class MeetingFailedEvent extends VendureEvent {
  constructor(
    public readonly meetingId: string,
    public readonly roomId: string | null,
    public readonly organizationId: string,
    public readonly reason: string,
    public readonly retryCount: number,
  ) {
    super();
  }
}

export class GrantConsumedEvent extends VendureEvent {
  constructor(
    public readonly grantId: string,
    public readonly meetingId: string,
    public readonly organizationId: string,
    public readonly consumedHours: number,
    public readonly remainingHours: number,
  ) {
    super();
  }
}

export class RoomActivatedEvent extends VendureEvent {
  constructor(
    public readonly roomId: string,
    public readonly meetingId: string,
    public readonly organizationId: string,
  ) {
    super();
  }
}

export class CapacityExhaustedEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly organization: BbbOrganization,
    public readonly grant: BbbCapacityGrant,
  ) {
    super();
  }
}

/**
 * Published when CapacityIntelligenceService detects that projected load
 * exceeds safe thresholds. Triggers operator notifications via subscriber plugins.
 *
 * Urgency levels:
 * - 'soon': 75-90% projected utilization
 * - 'immediate': > 90% projected utilization
 *
 * See ADR v1.7 §6A CI-005.
 */
export class CapacityAlertEvent extends VendureEvent {
  constructor(
    public readonly urgency: "soon" | "immediate",
    public readonly message: string,
    public readonly peakForecastAt: Date,
    public readonly serversNeeded: number,
  ) { super(); }
}
