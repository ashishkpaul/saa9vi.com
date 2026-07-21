import { InitialData, LanguageCode } from '@vendure/core';

/**
 * Minimal initial data for tenant-plugin e2e tests.
 *
 * Vendure requires at least one Zone, TaxCategory, ShippingMethod, and
 * PaymentMethod to exist before registerTenant can succeed — the
 * TenantRegistrationService copies the default channel's tax/shipping zones
 * to the new tenant Channel.
 */
export const E2E_INITIAL_DATA: InitialData = {
  defaultLanguage: LanguageCode.en,
  defaultZone: 'India',
  taxRates: [{ name: 'Standard Tax', percentage: 18 }],
  shippingMethods: [{ name: 'Standard Shipping', price: 0 }],
  paymentMethods: [
    {
      name: 'Dummy Payment',
      handler: { code: 'dummy-payment-handler', arguments: [] },
    },
  ],
  countries: [
    { name: 'India', code: 'IN', zone: 'India' },
  ],
  collections: [],
};
