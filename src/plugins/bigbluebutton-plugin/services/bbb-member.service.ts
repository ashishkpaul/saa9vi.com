// src/plugins/bigbluebutton-plugin/services/bbb-member.service.ts
// NEW FILE — M3

import { Injectable } from "@nestjs/common";
import {
  Channel,
  Customer,
  ForbiddenError,
  ID,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from "@vendure/core";
import { BbbOrganizationMember } from "../entities/bbb-organization-member.entity";
import { BbbOrganization } from "../entities/bbb-organization.entity";
import { MODERATOR_ROLES, ORG_ROLE } from "../constants";
import type { OrgRole } from "../constants";

export interface AddBbbMemberInput {
  organizationId: ID;
  customerId: ID;
  role: OrgRole;
}

export interface UpdateBbbMemberInput {
  role?: OrgRole;
  active?: boolean;
}

const loggerCtx = "BbbMemberService";

@Injectable()
export class BbbMemberService {
  constructor(private readonly connection: TransactionalConnection) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async findByOrganization(
    ctx: RequestContext,
    organizationId: ID,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: BbbOrganizationMember[]; totalItems: number }> {
    const take = Math.min(Math.max(options?.take ?? 25, 1), 100);
    const skip = Math.max(options?.skip ?? 0, 0);
    const [items, totalItems] = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findAndCount({
        where: { organization: { id: organizationId as string } },
        order: { createdAt: "ASC" },
        skip,
        take,
      });
    return { items, totalItems };
  }

  /** Returns all active memberships for a given customer across all orgs. */
  async findActiveByCustomer(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<BbbOrganizationMember[]> {
    return this.connection.getRepository(ctx, BbbOrganizationMember).find({
      where: { customerId: customerId as string, active: true },
      relations: ["organization"],
    });
  }

  /**
   * Resolves the membership for the currently authenticated customer within
   * the given organization. Returns null if no active membership exists.
   *
   * This is the primary authorization gate — call this before any meeting
   * action in the shop context.
   */
  async findActiveMembership(
    ctx: RequestContext,
    customerId: ID,
    organizationId: ID,
  ): Promise<BbbOrganizationMember | null> {
    return this.connection.getRepository(ctx, BbbOrganizationMember).findOne({
      where: {
        customerId: customerId as string,
        organization: { id: organizationId as string },
        active: true,
      },
    });
  }

  /**
   * Asserts the current customer is an active member of the given organization.
   * Throws ForbiddenError if not — maps cleanly to a 403 in the shop API.
   */
  async assertActiveMembership(
    ctx: RequestContext,
    customerId: ID,
    organizationId: ID,
  ): Promise<BbbOrganizationMember> {
    const member = await this.findActiveMembership(
      ctx,
      customerId,
      organizationId,
    );
    if (!member) {
      throw new ForbiddenError();
    }
    return member;
  }

  /**
   * Returns true if the member's role grants moderator-level BBB join access.
   * TRAINER and ORG_ADMIN receive the moderator join URL.
   * STUDENT receives the attendee join URL.
   */
  isModerator(member: BbbOrganizationMember): boolean {
    return MODERATOR_ROLES.includes(member.role);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────────

  async addMember(
    ctx: RequestContext,
    input: AddBbbMemberInput,
  ): Promise<BbbOrganizationMember> {
    // Validate org exists and load its channelId
    const org = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganization,
      input.organizationId,
    );

    // Validate role value
    const validRoles = Object.values(ORG_ROLE) as OrgRole[];
    if (!validRoles.includes(input.role)) {
      throw new UserInputError(
        `Invalid role "${input.role}". Valid values: ${validRoles.join(", ")}`,
      );
    }

    // Channel guard: the customer must belong to the same channel as the org.
    // This prevents a channel admin from enrolling customers from other channels.
    const channel = await this.connection
      .getRepository(ctx, Channel)
      .findOne({ where: { id: org.channelId as string } });

    if (channel) {
      const customerInChannel = await this.connection
        .getRepository(ctx, Customer)
        .createQueryBuilder("customer")
        .innerJoin("customer.channels", "channel", "channel.id = :channelId", {
          channelId: org.channelId,
        })
        .where("customer.id = :customerId", {
          customerId: input.customerId as string,
        })
        .getOne();

      if (!customerInChannel) {
        throw new UserInputError(
          `Customer ${input.customerId} is not a member of this channel.`,
        );
      }
    }

    // Check for existing membership (active or not)
    const existing = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findOne({
        where: {
          customerId: input.customerId as string,
          organization: { id: input.organizationId as string },
        },
      });

    if (existing) {
      if (existing.active) {
        throw new UserInputError(
          `Customer ${input.customerId} is already a member of this organization.`,
        );
      }
      // Re-activate a previously deactivated member with the new role
      existing.active = true;
      existing.role = input.role;
      return this.connection
        .getRepository(ctx, BbbOrganizationMember)
        .save(existing);
    }

    const member = new BbbOrganizationMember({
      organization: { id: input.organizationId } as BbbOrganization,
      customerId: input.customerId as string,
      role: input.role,
      active: true,
      keycloakSub: null,
    });

    return this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .save(member);
  }

  async updateMember(
    ctx: RequestContext,
    id: ID,
    input: UpdateBbbMemberInput,
  ): Promise<BbbOrganizationMember> {
    const member = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganizationMember,
      id,
    );

    if (input.role !== undefined) {
      const validRoles = Object.values(ORG_ROLE) as OrgRole[];
      if (!validRoles.includes(input.role)) {
        throw new UserInputError(
          `Invalid role "${input.role}". Valid values: ${validRoles.join(", ")}`,
        );
      }
      member.role = input.role;
    }

    if (input.active !== undefined) {
      member.active = input.active;
    }

    return this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .save(member);
  }

  /**
   * Soft-deactivates a member (sets active = false).
   * Hard delete is intentionally not exposed — preserve audit trail.
   */
  async removeMember(
    ctx: RequestContext,
    id: ID,
  ): Promise<BbbOrganizationMember> {
    const member = await this.connection.getEntityOrThrow(
      ctx,
      BbbOrganizationMember,
      id,
    );
    member.active = false;
    return this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .save(member);
  }

  // ─── M7: Member-aware org resolution ─────────────────────────────────────────

  /**
   * Resolves the organization for a given customer across all their memberships.
   * Used as a fallback when channel-based resolution is ambiguous.
   * Returns the first active membership's organization, ordered by most recently joined.
   */
  async findOrganizationByMembership(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<BbbOrganization | null> {
    const member = await this.connection
      .getRepository(ctx, BbbOrganizationMember)
      .findOne({
        where: { customerId: customerId as string, active: true },
        relations: ["organization"],
        order: { createdAt: "DESC" },
      });
    return member?.organization ?? null;
  }
}
