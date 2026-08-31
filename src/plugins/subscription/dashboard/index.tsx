import { CreditCardIcon, ReceiptIcon, AlertTriangleIcon, UsersIcon } from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { SubscriptionsList } from './routes/subscriptions/SubscriptionsList';
import { MandatesList } from './routes/mandates/MandatesList';
import { PaymentAttemptsList } from './routes/attempts/PaymentAttemptsList';
import { ReconciliationList } from './routes/reconciliation/ReconciliationList';

export default defineDashboardExtension({
    navSections: [
        {
            id: 'billing',
            title: 'Billing',
            icon: CreditCardIcon,
            placement: 'top',
            order: 110,
        },
    ],
    routes: [
        {
            path: '/billing/subscriptions',
            component: () => <SubscriptionsList />,
            navMenuItem: {
                sectionId: 'billing',
                title: 'Subscriptions',
                icon: UsersIcon,
                id: 'billing-subscriptions',
                url: '/billing/subscriptions',
                requiresPermission: ['SuperAdmin'],
            },
        },
        {
            path: '/billing/mandates',
            component: () => <MandatesList />,
            navMenuItem: {
                sectionId: 'billing',
                title: 'Mandates',
                icon: ReceiptIcon,
                id: 'billing-mandates',
                url: '/billing/mandates',
                requiresPermission: ['SuperAdmin'],
            },
        },
        {
            path: '/billing/attempts',
            component: () => <PaymentAttemptsList />,
            navMenuItem: {
                sectionId: 'billing',
                title: 'Payment Attempts',
                icon: CreditCardIcon,
                id: 'billing-attempts',
                url: '/billing/attempts',
                requiresPermission: ['SuperAdmin'],
            },
        },
        {
            path: '/billing/reconciliation',
            component: () => <ReconciliationList />,
            navMenuItem: {
                sectionId: 'billing',
                title: 'Reconciliation',
                icon: AlertTriangleIcon,
                id: 'billing-reconciliation',
                url: '/billing/reconciliation',
                requiresPermission: ['SuperAdmin'],
            },
        },
    ],
});
