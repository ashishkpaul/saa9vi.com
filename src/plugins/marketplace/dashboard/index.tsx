import { defineDashboardExtension } from '@vendure/dashboard';
import { MegaphoneIcon } from 'lucide-react';
import { campaignList } from './campaign-list';
import { campaignDetail } from './campaign-detail';
import { walletPage } from './wallet';
import { spendReport } from './spend-report';
import { attendanceOverview } from './attendance-overview';

defineDashboardExtension({
    routes: [campaignList, campaignDetail, walletPage, spendReport, attendanceOverview],
    navSections: [
        {
            id: 'marketplace',
            title: 'Marketplace',
            order: 200,
            icon: MegaphoneIcon,
        },
    ],
});
