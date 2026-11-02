import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED';

@Entity('course_announcement')
@Index(['courseId'])
@Index(['channelId'])
export class CourseAnnouncement extends VendureEntity {
  constructor(input?: DeepPartial<CourseAnnouncement>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  courseId: string;

  @Column({ type: 'varchar' })
  channelId: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', default: 'DRAFT' })
  status: AnnouncementStatus;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  authorId: string | null;
}
