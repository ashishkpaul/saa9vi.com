import { CrudPermissionDefinition } from '@vendure/core';

/**
 * Marketplace advertising permissions (3C.7a).
 *
 * Self-serve campaign/wallet management for tenant admins. Channel-scoped:
 * a tenant admin may only manage their own academy's campaigns and view
 * their own wallet. SuperAdmin bypasses the channel filter.
 */
export const marketplaceAdvertisingPermission =
  new CrudPermissionDefinition('MarketplaceAdvertising');

/** Convenience aliases mirroring the CRUD permission shape. */
export const CreateCampaignPermission = marketplaceAdvertisingPermission.Create;
export const ReadCampaignPermission = marketplaceAdvertisingPermission.Read;
export const UpdateCampaignPermission = marketplaceAdvertisingPermission.Update;
export const DeleteCampaignPermission = marketplaceAdvertisingPermission.Delete;

/**
 * Marketplace commission reporting permission (Gate R2).
 *
 * Read-only financial reconciliation/reporting for tenant admins, channel-
 * scoped (INV-002): a tenant admin reconciles only their own channel.
 * SuperAdmin may request all channels. Deliberately a separate permission
 * definition from advertising so financial-visibility grants are independent
 * of campaign-management grants.
 */
export const marketplaceCommissionPermission =
  new CrudPermissionDefinition('MarketplaceCommission');

export const ReadCommissionReportPermission = marketplaceCommissionPermission.Read;
