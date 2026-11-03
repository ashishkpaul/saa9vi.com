import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  ChannelService,
  ConfigService,
  ForbiddenError,
  ID,
  Permission,
  RequestContext,
  RequestContextService,
  Role,
  RoleService,
  TransactionalConnection,
  User,
} from '@vendure/core';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { CUSTOMER_ROLE_CODE } from '@vendure/common/lib/shared-constants';

const loggerCtx = 'ChannelRoleRepairService';

export interface ChannelRoleRepairResult {
  channelId: string;
  channelCode: string;
  channelToken: string;
  superAdminRoleAssigned: boolean;
  customerRoleAssigned: boolean;
  errors: string[];
}

/**
 * Service to repair built-in role (SuperAdmin and Customer) channel assignments.
 * 
 * Background: Channel 13 (`test-academy-f9hmus`) has its tenant administrator role
 * but is missing from the built-in SuperAdmin and Customer role channel assignments.
 * This prevents SuperAdmin from seeing the channel in the dashboard switcher and
 * prevents customers from authenticating against that channel.
 * 
 * Vendure 3.8.1's ChannelService.create() automatically assigns new channels to
 * both built-in roles via assignDefaultRolesToChannel(). Channel 13 was likely
 * created before this fix or through an alternative provisioning path.
 * 
 * This service provides a SuperAdmin-only GraphQL mutation to repair such cases.
 */
@Injectable()
export class ChannelRoleRepairService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly configService: ConfigService,
    private readonly requestContextService: RequestContextService,
    private readonly channelService: ChannelService,
    private readonly roleService: RoleService,
  ) {}

  /**
   * Get a SuperAdmin request context for performing repairs.
   */
  private async getSuperAdminContext(): Promise<RequestContext> {
    const { superadminCredentials } = this.configService.authOptions;
    const superAdminUser = await this.connection
      .getRepository(undefined, User)
      .findOne({
        where: { identifier: superadminCredentials.identifier },
        relations: ['roles', 'roles.channels'],
      });
    if (!superAdminUser) {
      throw new Error(
        'Could not find superadmin user for channel role repair',
      );
    }
    return this.requestContextService.create({
      apiType: 'admin',
      user: superAdminUser,
    });
  }

  /**
   * Repair built-in role assignments for a specific channel.
   * 
   * @param channelId - The channel ID to repair
   * @returns Repair result with status
   */
  async repairChannelRoleAssignments(
    channelId: ID,
  ): Promise<ChannelRoleRepairResult> {
    const superAdminCtx = await this.getSuperAdminContext();
    
    // Verify caller is SuperAdmin
    if (!superAdminCtx.userHasPermissions([Permission.SuperAdmin])) {
      throw new ForbiddenError();
    }

    const errors: string[] = [];
    
    // Get the channel
    const channel = await this.connection
      .getRepository(superAdminCtx, Channel)
      .findOne({ where: { id: channelId as string } });
    
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    Logger.log(`Repairing role assignments for channel ${channel.code} (id: ${channel.id})`, loggerCtx);

    // Get built-in roles
    const superAdminRole = await this.connection
      .getRepository(superAdminCtx, Role)
      .findOne({ 
        where: { code: SUPER_ADMIN_ROLE_CODE },
        relations: ['channels'],
      });

    const customerRole = await this.connection
      .getRepository(superAdminCtx, Role)
      .findOne({ 
        where: { code: CUSTOMER_ROLE_CODE },
        relations: ['channels'],
      });

    if (!superAdminRole) {
      throw new Error(`SuperAdmin role (${SUPER_ADMIN_ROLE_CODE}) not found`);
    }

    if (!customerRole) {
      throw new Error(`Customer role (${CUSTOMER_ROLE_CODE}) not found`);
    }

    let superAdminRoleAssigned = false;
    let customerRoleAssigned = false;

    // Check if SuperAdmin role already has this channel
    const superAdminHasChannel = superAdminRole.channels?.some(
      (ch) => ch.id === channel.id,
    );

    if (!superAdminHasChannel) {
      try {
        // Use RoleService to assign channel to SuperAdmin role
        await this.roleService.assignRoleToChannel(
          superAdminCtx,
          superAdminRole.id as ID,
          channel.id as ID,
        );
        superAdminRoleAssigned = true;
        Logger.log(`Assigned channel ${channel.code} to SuperAdmin role`, loggerCtx);
      } catch (error) {
        const errorMsg = `Failed to assign channel to SuperAdmin role: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        Logger.error(errorMsg, loggerCtx);
      }
    } else {
      superAdminRoleAssigned = true;
      Logger.debug(`SuperAdmin role already has channel ${channel.code}`, loggerCtx);
    }

    // Check if Customer role already has this channel
    const customerHasChannel = customerRole.channels?.some(
      (ch) => ch.id === channel.id,
    );

    if (!customerHasChannel) {
      try {
        // Use RoleService to assign channel to Customer role
        await this.roleService.assignRoleToChannel(
          superAdminCtx,
          customerRole.id as ID,
          channel.id as ID,
        );
        customerRoleAssigned = true;
        Logger.log(`Assigned channel ${channel.code} to Customer role`, loggerCtx);
      } catch (error) {
        const errorMsg = `Failed to assign channel to Customer role: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        Logger.error(errorMsg, loggerCtx);
      }
    } else {
      customerRoleAssigned = true;
      Logger.debug(`Customer role already has channel ${channel.code}`, loggerCtx);
    }

    return {
      channelId: channel.id as string,
      channelCode: channel.code,
      channelToken: channel.token,
      superAdminRoleAssigned,
      customerRoleAssigned,
      errors,
    };
  }

  /**
   * Check a channel's built-in role assignments.
   * 
   * @param channelId - The channel ID to check
   * @returns Diagnostic information about role assignments
   */
  async checkChannelRoleAssignments(
    channelId: ID,
  ): Promise<ChannelRoleRepairResult> {
    const superAdminCtx = await this.getSuperAdminContext();
    
    // Verify caller is SuperAdmin
    if (!superAdminCtx.userHasPermissions([Permission.SuperAdmin])) {
      throw new ForbiddenError();
    }

    const errors: string[] = [];
    
    // Get the channel
    const channel = await this.connection
      .getRepository(superAdminCtx, Channel)
      .findOne({ where: { id: channelId as string } });
    
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Get built-in roles with their channels
    const superAdminRole = await this.connection
      .getRepository(superAdminCtx, Role)
      .findOne({ 
        where: { code: SUPER_ADMIN_ROLE_CODE },
        relations: ['channels'],
      });

    const customerRole = await this.connection
      .getRepository(superAdminCtx, Role)
      .findOne({ 
        where: { code: CUSTOMER_ROLE_CODE },
        relations: ['channels'],
      });

    if (!superAdminRole) {
      errors.push(`SuperAdmin role (${SUPER_ADMIN_ROLE_CODE}) not found`);
    }

    if (!customerRole) {
      errors.push(`Customer role (${CUSTOMER_ROLE_CODE}) not found`);
    }

    const superAdminRoleAssigned = superAdminRole?.channels?.some(
      (ch) => ch.id === channel.id,
    ) ?? false;

    const customerRoleAssigned = customerRole?.channels?.some(
      (ch) => ch.id === channel.id,
    ) ?? false;

    if (!superAdminRoleAssigned) {
      errors.push(`SuperAdmin role missing channel assignment for ${channel.code}`);
    }

    if (!customerRoleAssigned) {
      errors.push(`Customer role missing channel assignment for ${channel.code}`);
    }

    return {
      channelId: channel.id as string,
      channelCode: channel.code,
      channelToken: channel.token,
      superAdminRoleAssigned,
      customerRoleAssigned,
      errors,
    };
  }
}
