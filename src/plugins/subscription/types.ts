/**
 * @description
 * The plugin can be configured using the following options:
 */
export interface PluginInitOptions {
    exampleOption?: string;
}

export enum RenewalResult {
  SUCCESS = "SUCCESS",
  CAS_CONFLICT = "CAS_CONFLICT",
  SUBSCRIPTION_NOT_FOUND = "SUBSCRIPTION_NOT_FOUND",
  CHANNEL_NOT_FOUND = "CHANNEL_NOT_FOUND",
  PAYMENT_FAILED = "PAYMENT_FAILED",
}
