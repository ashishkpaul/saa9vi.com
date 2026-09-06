import { defineDashboardExtension } from '@vendure/dashboard';
import { MegaphoneIcon } from 'lucide-react';
import { campaignList } from './campaign-list';
import { campaignDetail } from './campaign-detail';
import { walletPage } from './wallet';
import { spendReport } from './spend-report';
import { attendanceOverview } from './attendance-overview';
import { attendanceSessionDetail } from './attendance-session-detail';

defineDashboardExtension({
    routes: [campaignList, campaignDetail, walletPage, spendReport, attendanceOverview, attendanceSessionDetail],
    navSections: [
        {
            id: 'marketplace',
            title: 'Marketplace',
            order: 200,
            icon: MegaphoneIcon,
        },
    ],
});
