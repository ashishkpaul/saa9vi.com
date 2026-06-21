import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { articlePermission, bannerPermission, pagePermission } from './constants';
import { Article } from './entities/article.entity';
import { Banner } from './entities/banner.entity';
import { Page } from './entities/page.entity';
import { ArticleService } from './services/article.service';
import { BannerService } from './services/banner.service';
import { PageService } from './services/page.service';
import { CmsAdminResolver } from './api/cms-admin.resolver';
import { CmsShopResolver } from './api/cms-shop.resolver';
import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [Article, Banner, Page],
    providers: [ArticleService, BannerService, PageService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [CmsAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [CmsShopResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(articlePermission, bannerPermission, pagePermission);
        return config;
    },
    dashboard: './dashboard/index.tsx',
})
export class CmsPlugin {}
