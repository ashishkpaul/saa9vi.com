import { AccountRegistrationEvent, NativeAuthenticationMethod } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/**
 * Customer notification for account email verification upon registration.
 */
export const customerEmailVerificationHandler = new EmailEventListener('email-verification')
  .on(AccountRegistrationEvent)
  .filter((event) => {
    const nativeAuthMethod = event.user.authenticationMethods.find(
      (m) => m instanceof NativeAuthenticationMethod
    );
    return !!nativeAuthMethod?.identifier;
  })
  .setRecipient((event) => event.user.identifier)
  .setFrom('{{ fromAddress }}')
  .setSubject('Please Verify Your Email Address')
  .setTemplateVars((event) => ({
    verificationToken: event.user.getNativeAuthenticationMethod()?.verificationToken,
    user: event.user,
  }));
