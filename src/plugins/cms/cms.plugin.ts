import { PluginCommonModule, RuntimeVendureConfig, VendurePlugin } from '@vendure/core';
import { bannerActivatorTask } from './jobs/banner-activator.task';
import { articlePermission, bannerPermission, pagePermission } from './constants';
import { Article } from './entities/article.entity';
import { Banner } from './entities/banner.entity';
import { Page } from './entities/page.entity';
import { ArticleService } from './services/article.service';
import { BannerService } from './services/banner.service';
import { PageService } from './services/page.service';
import { CmsChannelAssignmentPolicy } from './services/cms-channel-assignment.policy';
import { CmsAdminResolver } from './api/cms-admin.resolver';
import { CmsShopResolver } from './api/cms-shop.resolver';
import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';

@VendurePlugin({
    compatibility: '^3.0.0',
    imports: [PluginCommonModule],
    entities: [Article, Banner, Page],
    providers: [ArticleService, BannerService, PageService, CmsChannelAssignmentPolicy],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [CmsAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [CmsShopResolver],
    },
    configuration: (config: RuntimeVendureConfig) => {
        config.authOptions.customPermissions.push(articlePermission, bannerPermission, pagePermission);

        // Register banner activator/deactivator scheduled task (BUG-015 / CMS-002)
        config.schedulerOptions.tasks = [
            ...(config.schedulerOptions.tasks ?? []),
            bannerActivatorTask,
        ];

        return config;
    },
    dashboard: './dashboard/index.tsx',
})
export class CmsPlugin {}
