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
