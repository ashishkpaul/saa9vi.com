import { ID, RequestContext } from "@vendure/core";

/**
 * S7A (Phase 7.2) — enqueue-only port for meeting provisioning.
 *
 * BbbMeetingService depends on this token + interface instead of on
 * BbbProvisioningWorkerService directly. The concrete implementation is
 * registered once by BigBlueButtonPlugin (`useExisting:
 * BbbProvisioningWorkerService`), which breaks the import cycle
 * meeting → provisioning-worker → room → meeting without changing queue
 * behavior: enqueue stays fire-and-forget behind the caller's
 * `setImmediate` deferral and `.catch()` logging.
 *
 * The port is deliberately enqueue-only: `doProvisionMeeting` and the
 * queue's own wiring are not part of this contract.
 */
export const BBB_PROVISIONING_ENQUEUER = Symbol("BBB_PROVISIONING_ENQUEUER");

export interface BbbProvisioningEnqueuer {
  /**
   * Enqueue one provisioning job for the given meeting.
   * Mirrors BbbProvisioningWorkerService.enqueueProvisioning().
   */
  enqueueProvisioning(ctx: RequestContext, meetingId: ID): Promise<void>;
}

