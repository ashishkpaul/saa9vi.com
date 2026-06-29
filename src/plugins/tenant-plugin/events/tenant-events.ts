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
