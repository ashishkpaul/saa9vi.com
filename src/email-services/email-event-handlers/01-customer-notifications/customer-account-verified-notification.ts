import { AccountVerifiedEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification sent when an account is verified.
 */
export const customerAccountVerifiedHandler = new EmailEventListener('customer-account-verified')
  .on(AccountVerifiedEvent)
  .setRecipient((event) => event.customer?.emailAddress || '')
  .setFrom('{{ fromAddress }}')
  .setSubject('Your Account Is Now Verified')
  .setTemplateVars((event) => ({
    customer: event.customer,
  }));
