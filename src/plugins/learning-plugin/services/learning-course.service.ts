import { Injectable, Logger } from '@nestjs/common';
import {
  ID,
  IllegalOperationError,
  ListQueryBuilder,
  PaginatedList,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { LearningCourse, CourseStatus } from '../entities/learning-course.entity';
import { CourseTemplate } from '../entities/course-template.entity';
import { CourseTemplateTool } from '../entities/course-template-tool.entity';
import { CourseTool } from '../entities/course-tool.entity';
import { CourseToolRegistry } from './course-tool-registry';

const loggerCtx = 'LearningCourseService';

export interface CreateCourseInput {
  slug: string;
  title: string;
  description?: string;
  templateId?: string;
}

export interface UpdateCourseInput {
  title?: string;
  description?: string;
}

@Injectable()
export class LearningCourseService {
  private readonly logger = new Logger(loggerCtx);

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly listQueryBuilder: ListQueryBuilder,
    private readonly toolRegistry: CourseToolRegistry,
  ) {}

  // ── Course CRUD ────────────────────────────────────────────────────────────

  async findOne(
    ctx: RequestContext,
    id: ID,
  ): Promise<LearningCourse | null> {
    const course = await this.connection
      .getRepository(ctx, LearningCourse)
      .findOne({ where: { id } });
    if (course && !this.canAccess(ctx, course)) {
      return null;
    }
    return course;
  }

  async findBySlug(
    ctx: RequestContext,
    slug: string,
  ): Promise<LearningCourse | null> {
    return this.connection.getRepository(ctx, LearningCourse).findOne({
      where: { channelId: String(ctx.channelId), slug },
    });
  }

  async findAll(
    ctx: RequestContext,
    options?: { skip?: number; take?: number },
  ): Promise<PaginatedList<LearningCourse>> {
    const [items, totalItems] = await this.connection
      .getRepository(ctx, LearningCourse)
      .findAndCount({
        where: { channelId: String(ctx.channelId) },
        order: { createdAt: 'DESC' },
        skip: options?.skip ?? 0,
        take: options?.take ?? 50,
      });
    return { items, totalItems };
  }

  async create(
    ctx: RequestContext,
    input: CreateCourseInput,
  ): Promise<LearningCourse> {
    const channelId = String(ctx.channelId);

    // Slug uniqueness check
    const existing = await this.findBySlug(ctx, input.slug);
    if (existing) {
      throw new IllegalOperationError(`Course slug "${input.slug}" already exists`);
    }

    // Create course
    const course = new LearningCourse({
      channelId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      status: 'DRAFT',
      templateId: input.templateId ?? null,
      createdByUserId: ctx.activeUserId != null ? String(ctx.activeUserId) : null,
    });

    const savedCourse = await this.connection
      .getRepository(ctx, LearningCourse)
      .save(course);

    // C-24: Snapshot template tools if a template was specified
    if (input.templateId) {
      await this.snapshotTemplateTools(ctx, String(savedCourse.id), input.templateId, channelId);
    } else {
      // No template: add default tools from the registry
      await this.addDefaultTools(ctx, String(savedCourse.id));
    }

    return savedCourse;
  }

  async update(
    ctx: RequestContext,
    id: ID,
    input: UpdateCourseInput,
  ): Promise<LearningCourse> {
    const course = await this.connection.getEntityOrThrow(ctx, LearningCourse, id);
    if (!this.canAccess(ctx, course)) {
      throw new IllegalOperationError('Cross-tenant course access denied');
    }
    if (course.status === 'ARCHIVED') {
      throw new IllegalOperationError('Archived courses cannot be edited');
    }
    if (input.title !== undefined) course.title = input.title;
    if (input.description !== undefined) course.description = input.description;
    return this.connection.getRepository(ctx, LearningCourse).save(course);
  }

  // ── Course lifecycle ──────────────────────────────────────────────────────

  async publish(ctx: RequestContext, id: ID): Promise<LearningCourse> {
    return this.transitionStatus(ctx, id, 'PUBLISHED');
  }

  async close(ctx: RequestContext, id: ID): Promise<LearningCourse> {
    return this.transitionStatus(ctx, id, 'CLOSED');
  }

  async archive(ctx: RequestContext, id: ID): Promise<LearningCourse> {
    return this.transitionStatus(ctx, id, 'ARCHIVED');
  }

  private async transitionStatus(
    ctx: RequestContext,
    id: ID,
    target: CourseStatus,
  ): Promise<LearningCourse> {
    const course = await this.connection.getEntityOrThrow(ctx, LearningCourse, id);
    if (!this.canAccess(ctx, course)) {
      throw new IllegalOperationError('Cross-tenant course access denied');
    }

    const transitions: Record<CourseStatus, CourseStatus[]> = {
      DRAFT: ['PUBLISHED'],
      PUBLISHED: ['CLOSED'],
      CLOSED: ['ARCHIVED'],
      ARCHIVED: [],
    };

    const allowed = transitions[course.status] ?? [];
    if (!allowed.includes(target)) {
      throw new IllegalOperationError(
        `Cannot transition course from ${course.status} to ${target}`,
      );
    }

    course.status = target;
    return this.connection.getRepository(ctx, LearningCourse).save(course);
  }

  // ── Course tools ──────────────────────────────────────────────────────────

  async getCourseTools(ctx: RequestContext, courseId: ID): Promise<CourseTool[]> {
    return this.connection.getRepository(ctx, CourseTool).find({
      where: { courseId: String(courseId) },
      order: { order: 'ASC' },
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Channel scoping: only same-channel callers can access the course. */
  private canAccess(ctx: RequestContext, course: LearningCourse): boolean {
    if (ctx.userHasPermissions(['SuperAdmin' as any])) return true;
    return String(course.channelId) === String(ctx.channelId);
  }

  /** Snapshot template tools into course tools (C-24). */
  private async snapshotTemplateTools(
    ctx: RequestContext,
    courseId: string,
    templateId: string,
    channelId: string,
  ): Promise<void> {
    // Find the template — platform default (null channelId) or tenant-specific
    const template = await this.connection
      .getRepository(ctx, CourseTemplate)
      .findOne({ where: { id: templateId } });

    if (!template) {
      throw new IllegalOperationError(`Template "${templateId}" not found`);
    }

    // Verify template belongs to this channel or is platform default
    if (template.channelId != null && template.channelId !== channelId) {
      throw new IllegalOperationError('Template does not belong to this channel');
    }

    const templateTools = await this.connection
      .getRepository(ctx, CourseTemplateTool)
      .find({ where: { templateId }, order: { order: 'ASC' } });

    // Validate all tool keys are known
    this.toolRegistry.validateTools(
      templateTools.map((t) => ({ toolKey: t.toolKey, settings: t.settings })),
    );

    // Snapshot each tool
    for (const tt of templateTools) {
      const tool = new CourseTool({
        courseId,
        toolKey: tt.toolKey,
        order: tt.order,
        visibility: tt.visibility,
        settings: tt.settings as any,
      });
      await this.connection.getRepository(ctx, CourseTool).save(tool);
    }
  }

  /** Add default tools from the registry when no template is specified. */
  private async addDefaultTools(ctx: RequestContext, courseId: string): Promise<void> {
    const tools = this.toolRegistry.list();
    for (let i = 0; i < tools.length; i++) {
      const def = tools[i];
      const tool = new CourseTool({
        courseId,
        toolKey: def.key,
        order: i,
        visibility: def.defaultVisibility,
        settings: null,
      });
      await this.connection.getRepository(ctx, CourseTool).save(tool);
    }
  }
}
