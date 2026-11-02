import { UserInputError } from '@vendure/core';

/**
 * N-06: Validation helpers for LearningPlugin inputs.
 * Slug format, title length, role enum, and take cap.
 */

const MAX_TAKE = 100;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TITLE_LENGTH = 200;
const MAX_ANNOUNCEMENT_TITLE = 200;

export const VALID_COURSE_ROLES = ['LEARNER', 'TRAINER', 'ASSISTANT'] as const;
export type ValidCourseRole = typeof VALID_COURSE_ROLES[number];

/**
 * Validate a course slug: lowercase alphanumeric with dashes, 1-80 chars.
 */
export function validateSlug(slug: string): void {
  if (!slug || slug.length === 0) {
    throw new UserInputError('slug is required');
  }
  if (slug.length > 80) {
    throw new UserInputError('slug must be 80 characters or fewer');
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new UserInputError(
      'slug must be lowercase alphanumeric with dashes (e.g. "intro-to-physics")',
    );
  }
}

/**
 * Validate a course or announcement title: non-empty, max 200 chars.
 */
export function validateTitle(title: string): void {
  if (!title || title.trim().length === 0) {
    throw new UserInputError('title is required');
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new UserInputError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }
}

/**
 * Validate announcement title.
 */
export function validateAnnouncementTitle(title: string): void {
  if (!title || title.trim().length === 0) {
    throw new UserInputError('title is required');
  }
  if (title.length > MAX_ANNOUNCEMENT_TITLE) {
    throw new UserInputError(`title must be ${MAX_ANNOUNCEMENT_TITLE} characters or fewer`);
  }
}

/**
 * Validate the course role enum. LEARNER is the default and only role
 * allowed for the enroll permission. TRAINER and ASSISTANT require
 * CourseManage.Update permission (checked in the resolver, not here).
 */
export function validateCourseRole(role: string): ValidCourseRole {
  if (!VALID_COURSE_ROLES.includes(role as ValidCourseRole)) {
    throw new UserInputError(
      `courseRole must be one of: ${VALID_COURSE_ROLES.join(', ')}`,
    );
  }
  return role as ValidCourseRole;
}

/**
 * Cap the `take` parameter at 100 for list queries.
 */
export function capTake(take?: number): number | undefined {
  if (take == null) return undefined;
  if (take < 1) return 1;
  if (take > MAX_TAKE) return MAX_TAKE;
  return take;
}
