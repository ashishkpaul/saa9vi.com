import { VendureEvent } from '@vendure/core';

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
