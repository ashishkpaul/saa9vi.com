import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type CourseRole = 'LEARNER' | 'TRAINER' | 'ASSISTANT';
export type EnrollmentStatus = 'INVITED' | 'ENROLLED' | 'SUSPENDED' | 'COMPLETED' | 'WITHDRAWN';

@Entity('course_enrollment')
@Index(['courseId', 'customerId'], { unique: true })
@Index(['channelId', 'customerId'])
@Index(['channelId', 'status'])
export class CourseEnrollment extends VendureEntity {
  constructor(input?: DeepPartial<CourseEnrollment>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  courseId: string;

  @Column({ type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar' })
  channelId: string;

  @Column({ type: 'varchar', default: 'LEARNER' })
  courseRole: CourseRole;

  @Column({ type: 'varchar', default: 'INVITED' })
  status: EnrollmentStatus;

  @Column({ type: 'varchar', nullable: true })
  invitedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  enrolledAt: Date | null;
}
