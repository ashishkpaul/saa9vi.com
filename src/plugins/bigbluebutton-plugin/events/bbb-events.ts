import { RequestContext, VendureEvent } from "@vendure/core";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";

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
