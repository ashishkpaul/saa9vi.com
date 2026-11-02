import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('course_scheduled_session')
@Index(['courseId', 'sessionId'], { unique: true })
@Index(['channelId'])
export class CourseScheduledSession extends VendureEntity {
  constructor(input?: DeepPartial<CourseScheduledSession>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  courseId: string;

  @Column({ type: 'varchar' })
  sessionId: string;

  @Column({ type: 'varchar' })
  channelId: string;
}
