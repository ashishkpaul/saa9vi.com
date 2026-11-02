import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type ToolVisibility = 'VISIBLE' | 'HIDDEN';

@Entity('course_template_tool')
@Index(['templateId'])
export class CourseTemplateTool extends VendureEntity {
  constructor(input?: DeepPartial<CourseTemplateTool>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  templateId: string;

  @Column({ type: 'varchar' })
  toolKey: string;

  @Column({ type: 'int', default: 0 })
  order: number;

  @Column({ type: 'varchar', default: 'VISIBLE' })
  visibility: ToolVisibility;

  @Column({ type: 'jsonb', nullable: true })
  settings: Record<string, unknown> | null;
}
