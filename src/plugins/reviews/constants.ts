import { PermissionDefinition } from '@vendure/core';

export const REVIEW_ADMIN_PERMISSION = new PermissionDefinition({
    name: 'ReviewAdmin',
    description: 'Allows access to review management features',
});

/**
 * Represents the type of entity being reviewed.
 */
export enum ReviewTargetType {
    PRODUCT = 'PRODUCT',
    COURSE = 'COURSE',
    BBB_MEETING = 'BBB_MEETING',
    INSTRUCTOR = 'INSTRUCTOR',
    ACADEMY = 'ACADEMY',
    CONTENT = 'CONTENT',
}

/**
 * Represents how a review's verification was established.
 */
export enum ReviewVerificationType {
    NONE = 'NONE',
    ORDER = 'ORDER',
    ENROLLMENT = 'ENROLLMENT',
    BBB_ATTENDANCE = 'BBB_ATTENDANCE',
    CERTIFICATE = 'CERTIFICATE',
    ADMIN = 'ADMIN',
}
