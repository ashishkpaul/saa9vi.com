/**
 * LearnerAdmissionPort (C-10)
 *
 * A typed injection token and interface for cross-plugin academy admission
 * checks. BigBlueButtonPlugin uses this instead of accessing
 * TenantLearnerMembership via string-named getRepository(), which creates a
 * hidden cross-plugin data coupling.
 *
 * Usage:
 *   // In BigBlueButtonPlugin (consumer):
 *   @Inject(LEARNER_ADMISSION_PORT) private readonly admissionPort: LearnerAdmissionPort
 *
 *   // In TenantPlugin (provider) — registered via the existing
 *   // TenantLearnerMembershipService already exported from TenantPlugin.
 *
 * Only add operations here that are genuinely needed by BBB or other plugins.
 * Academy admission business logic stays in TenantLearnerMembershipService.
 */

import { RequestContext } from '@vendure/core';
import { ID } from '@vendure/core';

export const LEARNER_ADMISSION_PORT = 'LEARNER_ADMISSION_PORT';

export type LearnerAdmissionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'LEFT';

export interface LearnerAdmissionPort {
  /**
   * Returns true iff the customer has an ACTIVE TenantLearnerMembership in
   * the specified channel. Fails closed (returns false) on any error.
   */
  isActiveMember(ctx: RequestContext, customerId: ID, channelId: string): Promise<boolean>;

  /**
   * Returns the customer's current admission status in the specified channel,
   * or null when no membership row exists.
   * Fails closed (returns null) on any error.
   */
  getStatus(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<LearnerAdmissionStatus | null>;
}
