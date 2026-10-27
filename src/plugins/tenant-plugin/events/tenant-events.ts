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
 * Published when a TenantProfile is created with its stable tenantSlug.
 * Consumers use this event for academy provisioning: the BBB plugin creates
 * or reconciles the channel's BbbOrganization and default rooms, while the
 * subscription plugin provisions the free plan. This event is independent
 * of hostname routing; Saa9vi no longer provisions seller subdomains.
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
