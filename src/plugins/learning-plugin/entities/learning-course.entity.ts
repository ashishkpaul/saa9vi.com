import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';

@Entity('learning_course')
@Index(['channelId', 'slug'], { unique: true })
@Index(['channelId', 'status'])
export class LearningCourse extends VendureEntity {
  constructor(input?: DeepPartial<LearningCourse>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  channelId: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'DRAFT' })
  status: CourseStatus;

  @Column({ type: 'varchar', nullable: true })
  templateId: string | null;

  @Column({ type: 'varchar', nullable: true })
  createdByUserId: string | null;
}
