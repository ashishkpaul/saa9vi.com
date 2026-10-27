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
 * Published once when a TenantProfile is created during self-serve
 * registration. Downstream consumers (BigBlueButton organisation provisioning,
 * free-plan activation) rely on this event to provision channel-scoped
 * resources. The tenantSlug carried here is an internal identity slug used
 * for BbbOrganization.slug and central marketplace routes — it is NOT a
 * hostname, and no {tenantSlug}.saa9vi.com mapping is provisioned from it.
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
