import { PasswordResetEvent } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification for forgotten password reset.
 */
export const customerPasswordResetHandler = new EmailEventListener('password-reset')
  .on(PasswordResetEvent)
  .setRecipient((event) => event.user.identifier)
  .setFrom('{{ fromAddress }}')
  .setSubject('Password Reset Instructions')
  .setTemplateVars((event) => ({
    passwordResetToken: event.user.getNativeAuthenticationMethod()?.passwordResetToken,
    user: event.user,
  }));
