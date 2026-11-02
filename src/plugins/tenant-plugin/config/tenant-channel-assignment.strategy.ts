import { Injector } from '@vendure/core';
import {
  CustomerChannelAssignmentStrategy,
  ID,
  RequestContext,
} from '@vendure/core';
import {
  LEARNER_ADMISSION_PORT,
  LearnerAdmissionPort,
} from '../../../platform/learner-admission.port';

/**
 * Invitation-aware channel assignment strategy (C-10 update).
 *
 * A customer is only auto-assigned to a tenant channel if they have an
 * ACTIVE TenantLearnerMembership in that channel. Uses LearnerAdmissionPort
 * instead of querying TenantLearnerMembership directly, removing the
 * string-named cross-plugin repository coupling.
 *
 * NOTE: This controls channel assignment, not API access. Returning `false`
 * won't block the request — service-layer H1/H2 checks remain the
 * authoritative authorization boundary.
 *
 * The default channel is excluded — Vendure skips this strategy for the
 * default channel, so platform-level access is unaffected.
 */
export class TenantChannelAssignmentStrategy
  implements CustomerChannelAssignmentStrategy
{
  private admissionPort: LearnerAdmissionPort | null = null;

  init(injector: Injector): void | Promise<void> {
    try {
      this.admissionPort = injector.get<LearnerAdmissionPort>(LEARNER_ADMISSION_PORT);
    } catch {
      // Fail closed: if the port is not resolvable, deny assignment.
      this.admissionPort = null;
    }
  }

  async canAssignCustomerToChannel(
    ctx: RequestContext,
    customer: { id: ID },
    channelId: ID,
  ): Promise<boolean> {
    if (!this.admissionPort) {
      return false;
    }

    try {
      return await this.admissionPort.isActiveMember(ctx, customer.id, String(channelId));
    } catch {
      // Fail closed on any error.
      return false;
    }
  }
}
