/**
 * LearnerAdmissionModule (C-10)
 *
 * A lightweight NestJS module that exports only the LearnerAdmissionPort
 * token, backed by TenantLearnerMembershipService. BigBlueButtonPlugin
 * imports this module so BbbAdminResolver can inject the port without
 * importing the full TenantPlugin (which would create a dependency cycle
 * through the shared VendurePlugin metadata).
 *
 * TenantPlugin registers TenantLearnerMembershipService as a provider and
 * also provides LEARNER_ADMISSION_PORT (useExisting). This module re-exports
 * the same pair for the BBB import context.
 */
import { Module } from '@nestjs/common';
import { PluginCommonModule } from '@vendure/core';
import { TenantLearnerMembershipService } from '../plugins/tenant-plugin/services/tenant-learner-membership.service';
import { LEARNER_ADMISSION_PORT } from './learner-admission.port';

@Module({
  imports: [PluginCommonModule],
  providers: [
    TenantLearnerMembershipService,
    {
      provide: LEARNER_ADMISSION_PORT,
      useExisting: TenantLearnerMembershipService,
    },
  ],
  exports: [LEARNER_ADMISSION_PORT],
})
export class LearnerAdmissionModule {}
