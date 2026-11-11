import { CreditCardIcon, SettingsIcon } from 'lucide-react';
import { defineDashboardExtension } from '@vendure/dashboard';

import { PaymentGatewaysConfiguration } from './routes/payment-gateways/PaymentGatewaysConfiguration';

/**
 * Dashboard extension for tenant payment gateway management (Phase 2.4).
 * 
 * Provides a dedicated Settings → Payment Gateways page for tenant administrators
 * to configure their own Razorpay credentials, separate from the platform's
 * global Payment Methods configuration.
 * 
 * All operations are scoped to the current channel and require the
 * `ManageTenantPaymentAccount` permission.
 */
export default defineDashboardExtension({
  navSections: [
    {
      id: 'settings',
      title: 'Settings',
      icon: SettingsIcon,
      placement: 'bottom',
      order: 100,
    },
  ],
  routes: [
    {
      path: '/settings/payment-gateways',
      component: () => <PaymentGatewaysConfiguration />,
      navMenuItem: {
        sectionId: 'settings',
        title: 'Payment Gateways',
        icon: CreditCardIcon,
        id: 'payment-gateways',
        url: '/settings/payment-gateways',
        requiresPermission: ['SuperAdmin', 'ManageTenantPaymentAccount'],
      },
    },
  ],
});
