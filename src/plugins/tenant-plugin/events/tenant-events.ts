import { RequestContext, VendureEvent } from '@vendure/core';

export class InstructorProfileCreatedEvent extends VendureEvent {
  constructor(
    public readonly instructorProfileId: string,
    public readonly channelId: string,
  ) {
    super();
  }
}

export class InstructorProfileUpdatedEvent extends VendureEvent {
  constructor(
    public readonly instructorProfileId: string,
    public readonly channelId: string,
    public readonly updatedFields: string[],
  ) {
    super();
  }
}

/**
 * Published when a TenantProfile (academy profile) is updated (Gate 1.4 / F5).
 * Marketplace consumers must invalidate every marketplace document belonging
 * to this channel (businessName, customDomain, logo feed routing/presentation).
 */
export class TenantProfileUpdatedEvent extends VendureEvent {
  constructor(
    public readonly tenantProfileId: string,
    public readonly channelId: string,
    public readonly updatedFields: string[],
  ) {
    super();
  }
}

/**
 * Published once when a TenantProfile with a tenantSlug is created during
 * self-serve registration (G1/B-2). The BBB plugin consumes this to
 * auto-provision the channel's BbbOrganization with slug === tenantSlug, so
 * the marketplace academySlug and the platform hostname can never diverge.
 * Consumers must be idempotent-friendly: creation is skipped if an org
 * already exists for the channel (BbbOrganizationService.create enforces
 * one org per channel).
 */
export class TenantRegisteredEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly tenantProfileId: string,
    public readonly channelId: string,
    public readonly tenantSlug: string,
    public readonly businessName: string,
  ) {
    super();
  }
}
