import { CrudPermissionDefinition } from '@vendure/core';

export const loggerCtx = 'CmsPlugin';

/**
 * CrudPermissionDefinition('Article') generates 4 Permissions:
 * CreateArticle, ReadArticle, UpdateArticle, DeleteArticle — and registers
 * them as a named group in the Dashboard's Role permission matrix.
 */
export const articlePermission = new CrudPermissionDefinition('CmsArticle');
export const bannerPermission = new CrudPermissionDefinition('CmsBanner');
export const pagePermission = new CrudPermissionDefinition('CmsPage');
