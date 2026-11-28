import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ID, RequestContext, TransactionalConnection } from "@vendure/core";
import { KeycloakIdentity } from "../entities/keycloak-identity.entity";

const loggerCtx = "KeycloakIdentityService";

/**
 * Service for Keycloak identity mapping records.
 *
 * PR 2 scope: establishes the data model for storing validated Keycloak
 * `iss` + `sub` pairs mapped to a tenant channel. The actual linking of
 * a Keycloak identity to a Vendure customer/administrator happens in
 * PR 4 (Keycloak provisioning). PR 2 itself does not perform any
 * Keycloak user provisioning.
 *
 * All operations are channel-scoped per INV-001. The unique index on
 * (issuer, subject) enforces the person-one-tenant rule at the
 * database level.
 */
@Injectable()
export class KeycloakIdentityService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  // ── Read helpers ──────────────────────────────────────────────────────

  async findOne(
    ctx: RequestContext,
    id: ID,
  ): Promise<KeycloakIdentity | null> {
    return this.connection
      .getRepository(ctx, KeycloakIdentity)
      .findOne({ where: { id: String(id) } });
  }

  async findByIssuerSubject(
    ctx: RequestContext,
    issuer: string,
    subject: string,
  ): Promise<KeycloakIdentity | null> {
    return this.connection
      .getRepository(ctx, KeycloakIdentity)
      .findOne({ where: { issuer, subject } });
  }

  async findByChannel(
    ctx: RequestContext,
    channelId: string,
  ): Promise<KeycloakIdentity[]> {
    return this.connection.getRepository(ctx, KeycloakIdentity).find({
      where: { channelId: String(channelId) },
      order: { createdAt: "DESC" },
    });
  }

  async findByCustomer(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<KeycloakIdentity[]> {
    return this.connection.getRepository(ctx, KeycloakIdentity).find({
      where: { customerId: String(customerId) },
      order: { createdAt: "DESC" },
    });
  }

  async findByAdministrator(
    ctx: RequestContext,
    administratorId: ID,
  ): Promise<KeycloakIdentity[]> {
    return this.connection.getRepository(ctx, KeycloakIdentity).find({
      where: { administratorId: String(administratorId) },
      order: { createdAt: "DESC" },
    });
  }

  // ── Write operations ──────────────────────────────────────────────────

  /**
   * Create a new Keycloak identity mapping.
   *
   * Fails if a mapping with the same (issuer, subject) already exists
   * (person-one-tenant rule, enforced by the unique index).
   */
  async create(
    ctx: RequestContext,
    input: {
      channelId: string;
      issuer: string;
      subject: string;
      customerId?: ID | null;
      administratorId?: ID | null;
    },
  ): Promise<KeycloakIdentity> {
    const existing = await this.findByIssuerSubject(
      ctx,
      input.issuer,
      input.subject,
    );
    if (existing) {
      throw new Error(
        `Keycloak identity already mapped: issuer="${input.issuer}" subject="${input.subject}" ` +
          `is already associated with identity id ${existing.id} (channel ${existing.channelId}). ` +
          "A Keycloak subject may only be mapped to one tenant (person-one-tenant rule).",
      );
    }

    const identity = new KeycloakIdentity({
      channelId: String(input.channelId),
      issuer: input.issuer,
      subject: input.subject,
      customerId: input.customerId ? String(input.customerId) : null,
      administratorId: input.administratorId
        ? String(input.administratorId)
        : null,
    });

    const saved = await this.connection
      .getRepository(ctx, KeycloakIdentity)
      .save(identity);
    this.logger.log(
      `Created KeycloakIdentity id=${saved.id} issuer="${input.issuer}" subject="${input.subject}" channel=${input.channelId}`,
      loggerCtx,
    );
    return saved;
  }

  /**
   * Link a Keycloak identity to a Vendure customer.
   * Called from PR 4 (Keycloak provisioning).
   */
  async linkCustomer(
    ctx: RequestContext,
    identityId: ID,
    customerId: ID,
  ): Promise<KeycloakIdentity> {
    const identity = await this.findOne(ctx, identityId);
    if (!identity) {
      throw new NotFoundException(
        `KeycloakIdentity id=${identityId} not found`,
      );
    }
    identity.customerId = String(customerId);
    const saved = await this.connection
      .getRepository(ctx, KeycloakIdentity)
      .save(identity);
    this.logger.log(
      `Linked KeycloakIdentity id=${saved.id} to customerId=${customerId}`,
      loggerCtx,
    );
    return saved;
  }

  /**
   * Link a Keycloak identity to a Vendure administrator.
   * Called from PR 4 (Keycloak provisioning).
   */
  async linkAdministrator(
    ctx: RequestContext,
    identityId: ID,
    administratorId: ID,
  ): Promise<KeycloakIdentity> {
    const identity = await this.findOne(ctx, identityId);
    if (!identity) {
      throw new NotFoundException(
        `KeycloakIdentity id=${identityId} not found`,
      );
    }
    identity.administratorId = String(administratorId);
    const saved = await this.connection
      .getRepository(ctx, KeycloakIdentity)
      .save(identity);
    this.logger.log(
      `Linked KeycloakIdentity id=${saved.id} to administratorId=${administratorId}`,
      loggerCtx,
    );
    return saved;
  }

  /**
   * Remove a Keycloak identity mapping.
   */
  async delete(
    ctx: RequestContext,
    id: ID,
  ): Promise<boolean> {
    const identity = await this.findOne(ctx, id);
    if (!identity) {
      return false;
    }
    await this.connection
      .getRepository(ctx, KeycloakIdentity)
      .remove(identity);
    this.logger.log(
      `Deleted KeycloakIdentity id=${id}`,
      loggerCtx,
    );
    return true;
  }
}
