import { CrudPermissionDefinition, Permission } from '@vendure/core';
import {
  BbbManageEntitlementsPermission,
  BbbManageMeetingsPermission,
  BbbManageMembersPermission,
  BbbManageOrganizationsPermission,
  BbbManageRoomsPermission,
  BbbManageSessionsPermission,
  BbbPlatformInfrastructurePermission,
} from '../bigbluebutton-plugin/constants';
import {
  articlePermission,
  bannerPermission,
  pagePermission,
} from '../cms/constants';
import { REVIEW_ADMIN_PERMISSION } from '../reviews/constants';

export const TENANT_PLUGIN_OPTIONS = 'TENANT_PLUGIN_OPTIONS';

export const tenantProfilePermission = new CrudPermissionDefinition('TenantProfile');
export const instructorProfilePermission = new CrudPermissionDefinition('InstructorProfile');
export const mediaResourcePermission = new CrudPermissionDefinition('MediaResource');

/**
 * Permissions granted to a new tenant's Administrator on their own Channel via
 * a channel-scoped Role — never SuperAdmin. Base set matches the "tenant
 * administrator" permissions from Vendure's own multi-tenant guide (Tag,
 * ShippingMethod, Promotion, PaymentMethod, Order, Facet, CustomerGroup,
 * Customer, Collection, Asset, Catalog), plus this plugin's own CRUD
 * permission definitions so the tenant can manage their TenantProfile,
 * InstructorProfile, and MediaResource records from day one.
 *
 * Used by TenantRegistrationService.registerTenant() — see
 * services/tenant-registration.service.ts.
 */
export const TENANT_ADMIN_ROLE_PERMISSIONS: Permission[] = [
  Permission.CreateCatalog,
  Permission.ReadCatalog,
  Permission.UpdateCatalog,
  Permission.DeleteCatalog,
  Permission.CreateAsset,
  Permission.ReadAsset,
  Permission.UpdateAsset,
  Permission.DeleteAsset,
  Permission.CreateCollection,
  Permission.ReadCollection,
  Permission.UpdateCollection,
  Permission.DeleteCollection,
  Permission.CreateCustomer,
  Permission.ReadCustomer,
  Permission.UpdateCustomer,
  Permission.DeleteCustomer,
  Permission.CreateCustomerGroup,
  Permission.ReadCustomerGroup,
  Permission.UpdateCustomerGroup,
  Permission.DeleteCustomerGroup,
  Permission.CreateFacet,
  Permission.ReadFacet,
  Permission.UpdateFacet,
  Permission.DeleteFacet,
  Permission.CreateOrder,
  Permission.ReadOrder,
  Permission.UpdateOrder,
  Permission.DeleteOrder,
  Permission.CreatePaymentMethod,
  Permission.ReadPaymentMethod,
  Permission.UpdatePaymentMethod,
  Permission.DeletePaymentMethod,
  Permission.CreatePromotion,
  Permission.ReadPromotion,
  Permission.UpdatePromotion,
  Permission.DeletePromotion,
  Permission.CreateShippingMethod,
  Permission.ReadShippingMethod,
  Permission.UpdateShippingMethod,
  Permission.DeleteShippingMethod,
  Permission.CreateTag,
  Permission.ReadTag,
  Permission.UpdateTag,
  Permission.DeleteTag,
  // This plugin's own custom CRUD permissions
  tenantProfilePermission.Create,
  tenantProfilePermission.Read,
  tenantProfilePermission.Update,
  tenantProfilePermission.Delete,
  instructorProfilePermission.Create,
  instructorProfilePermission.Read,
  instructorProfilePermission.Update,
  instructorProfilePermission.Delete,
  mediaResourcePermission.Create,
  mediaResourcePermission.Read,
  mediaResourcePermission.Update,
  mediaResourcePermission.Delete,
  // BigBlueButton granular permissions (Phase B) — scoped access, not BBBAdmin
  BbbPlatformInfrastructurePermission.Permission,
  BbbManageOrganizationsPermission.Permission,
  BbbManageRoomsPermission.Permission,
  BbbManageSessionsPermission.Permission,
  BbbManageMeetingsPermission.Permission,
  BbbManageEntitlementsPermission.Permission,
  BbbManageMembersPermission.Permission,
  // CMS CRUD permissions
  articlePermission.Create,
  articlePermission.Read,
  articlePermission.Update,
  articlePermission.Delete,
  bannerPermission.Create,
  bannerPermission.Read,
  bannerPermission.Update,
  bannerPermission.Delete,
  pagePermission.Create,
  pagePermission.Read,
  pagePermission.Update,
  pagePermission.Delete,
  // Reviews
  REVIEW_ADMIN_PERMISSION.Permission,
];
