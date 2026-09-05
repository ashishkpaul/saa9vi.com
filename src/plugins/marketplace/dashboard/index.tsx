import { defineDashboardExtension } from '@vendure/dashboard';
import { MegaphoneIcon } from 'lucide-react';
import { campaignList } from './campaign-list';
import { campaignDetail } from './campaign-detail';
import { walletPage } from './wallet';
import { spendReport } from './spend-report';

defineDashboardExtension({
    routes: [campaignList, campaignDetail, walletPage, spendReport],
    navSections: [
        {
            id: 'marketplace',
            title: 'Marketplace',
            order: 200,
            icon: MegaphoneIcon,
        },
    ],
});
