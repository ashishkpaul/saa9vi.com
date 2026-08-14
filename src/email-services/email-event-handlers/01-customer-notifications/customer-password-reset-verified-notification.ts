import { PasswordResetVerifiedEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification confirming password reset completed successfully.
 */
export const customerPasswordResetVerifiedHandler = new EmailEventListener(
  'customer-password-reset-verified'
)
  .on(PasswordResetVerifiedEvent)
  .setRecipient((event) => event.user.identifier)
  .setFrom('{{ fromAddress }}')
  .setSubject('Your Password Has Been Successfully Reset')
  .setTemplateVars((event) => ({
    user: event.user,
  }));
