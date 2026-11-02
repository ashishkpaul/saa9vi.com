import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('course_template')
@Index(['channelId', 'name'])
export class CourseTemplate extends VendureEntity {
  constructor(input?: DeepPartial<CourseTemplate>) {
    super(input);
  }

  /** null = platform default template */
  @Column({ type: 'varchar', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;
}
