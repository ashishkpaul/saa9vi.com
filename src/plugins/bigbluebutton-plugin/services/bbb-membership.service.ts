import { Injectable } from "@nestjs/common";
import {
  ID,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from "@vendure/core";
import { BbbOrganizationMembership } from "../entities/bbb-organization-membership.entity";

export interface CreateBbbMembershipInput {
  organizationId: string;
  customerId: string;
  channelId: string;
  role: "org_admin" | "moderator" | "staff";
}

export interface UpdateBbbMembershipInput {
  role?: "org_admin" | "moderator" | "staff";
  isActive?: boolean;
}

const VALID_ROLES = ["org_admin", "moderator", "staff"] as const;
const MODERATOR_ROLES = ["org_admin", "moderator"] as const;

const loggerCtx = "BbbMembershipService";

/**
 * Manages organization staff memberships for Archetype B (Internal Staff
 * Meeting flow).
 *
 * This is the FEAT-001 service that provides staff short-circuit auth
 * for internal rooms. Staff members bypass the entitlement check entirely
 * and receive role-based join URLs (MODERATOR for org_admin/moderator,
 * VIEWER for staff).
 */
@Injectable()
export class BbbMembershipService {
  constructor(private readonly connection: TransactionalConnection) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  /**
   * Finds a single active membership for a customer within an organization.
   * This is the primary auth gate — returns null if no active membership exists.
   */
  async findActiveMembership(
    ctx: RequestContext,
    customerId: ID,
    organizationId: ID,
  ): Promise<BbbOrganizationMembership | null> {
    return this.connection.getRepository(ctx, BbbOrganizationMembership).findOne({
      where: {
        customerId: customerId as string,
        organizationId: organizationId as string,
        isActive: true,
      },
    });
  }

  /**
   * Lists all memberships for a given organization.
   */
  async listByOrganization(
    ctx: RequestContext,
    organizationId: ID,
  ): Promise<BbbOrganizationMembership[]> {
    return this.connection.getRepository(ctx, BbbOrganizationMembership).find({
      where: { organizationId: organizationId as string },
      order: { createdAt: "ASC" },
    });
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /**
   * Creates a new organization membership.
   */
  async create(
    ctx: RequestContext,
    input: CreateBbbMembershipInput,
  ): Promise<BbbOrganizationMembership> {
    if (!VALID_ROLES.includes(input.role as any)) {
      throw new UserInputError(
        `Invalid role "${input.role}". Valid values: ${VALID_ROLES.join(", ")}`,
      );
    }

    // Check for existing membership (active or not)
    const existing = await this.connection
      .getRepository(ctx, BbbOrganizationMembership)
      .findOne({
        where: {
          customerId: input.customerId,
          organizationId: input.organizationId,
        },
      });

    if (existing) {
      if (existing.isActive) {
        throw new UserInputError(
          `Customer ${input.customerId} already has an active membership in this organization.`,
        );
      }
      // Re-activate a deactivated membership with the new role
      existing.isActive = true;
      existing.role = input.role as any;
      existing.channelId = input.channelId;
      return this.connection
        .getRepository(ctx, BbbOrganizationMembership)
        .save(existing);
    }

    const membership = new BbbOrganizationMembership({
      organizationId: input.organizationId,
      customerId: input.customerId,
      channelId: input.channelId,
      role: input.role,
      isActive: true,
    });

    return this.connection
      .getRepository(ctx, BbbOrganizationMembership)
      .save(membership);
  }

  /**
   * Updates an existing membership (role, active status).
   */
  async update(
    ctx: RequestContext,
    id: ID,
    input: UpdateBbbMembershipInput,
  ): Promise<BbbOrganizationMembership> {
    const membership = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganizationMembership,
      id,
    );

    if (input.role !== undefined) {
      if (!VALID_ROLES.includes(input.role as any)) {
        throw new UserInputError(
          `Invalid role "${input.role}". Valid values: ${VALID_ROLES.join(", ")}`,
        );
      }
      membership.role = input.role;
    }

    if (input.isActive !== undefined) {
      membership.isActive = input.isActive;
    }

    return this.connection
      .getRepository(ctx, BbbOrganizationMembership)
      .save(membership);
  }

  /**
   * Removes a membership by id (hard delete).
   */
  async remove(ctx: RequestContext, id: ID): Promise<void> {
    const membership = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganizationMembership,
      id,
    );
    await this.connection
      .getRepository(ctx, BbbOrganizationMembership)
      .remove(membership);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Returns true if the membership role grants moderator-level BBB join access.
   * org_admin and moderator receive the MODERATOR join URL.
   * staff receives the VIEWER join URL.
   */
  isModeratorRole(role: "org_admin" | "moderator" | "staff"): boolean {
    return (MODERATOR_ROLES as readonly string[]).includes(role);
  }
}
