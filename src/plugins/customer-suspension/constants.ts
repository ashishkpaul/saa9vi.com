import { PermissionDefinition } from "@vendure/core";

export const CUSTOMER_SUSPENSION_PLUGIN_OPTIONS = Symbol('CUSTOMER_SUSPENSION_PLUGIN_OPTIONS');
export const loggerCtx = 'CustomerSuspensionPlugin';

/**
 * Dedicated permission for customer suspension operations.
 * Using a dedicated permission allows fine-grained access control:
 * - Academy support reps can suspend customers without full customer edit rights
 * - Can be granted independently of Permission.UpdateCustomer
 */
export const CustomerSuspensionPermission = new PermissionDefinition({
  name: 'ManageCustomerSuspension',
  description: 'Allows suspending and reinstating customer accounts',
});
