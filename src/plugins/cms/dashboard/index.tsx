import { defineDashboardExtension } from '@vendure/dashboard';
import { LayoutTemplate } from 'lucide-react';
import { articleList } from './article-list';
import { articleDetail } from './article-detail';
import { bannerList } from './banner-list';
import { bannerDetail } from './banner-detail';
import { pageList } from './page-list';
import { pageDetail } from './page-detail';

defineDashboardExtension({
    routes: [articleList, articleDetail, bannerList, bannerDetail, pageList, pageDetail],
    navSections: [
        {
            id: 'cms',
            title: 'CMS',
            // Placed after the built-in sections; order is a position hint,
            // not an absolute index — see the Navigation guide for details.
            order: 100,
            icon: LayoutTemplate,
        },
    ],
});
