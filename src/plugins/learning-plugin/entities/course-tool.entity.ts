import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import type { ToolVisibility } from './course-template-tool.entity';

@Entity('course_tool')
@Index(['courseId', 'toolKey'], { unique: true })
@Index(['courseId'])
export class CourseTool extends VendureEntity {
  constructor(input?: DeepPartial<CourseTool>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  courseId: string;

  @Column({ type: 'varchar' })
  toolKey: string;

  @Column({ type: 'int', default: 0 })
  order: number;

  @Column({ type: 'varchar', default: 'VISIBLE' })
  visibility: ToolVisibility;

  @Column({ type: 'jsonb', nullable: true })
  settings: Record<string, unknown> | null;
}
