import {
  Administrator,
  AdministratorService,
  AuthenticationStrategy,
  ExternalAuthenticationService,
  Injector,
  Logger,
  RequestContext,
  Role,
  RoleService,
  TransactionalConnection,
  User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';
import { KeycloakIdentity } from '../entities/keycloak-identity.entity';

export type KeycloakAuthData = {
  token: string;
};

export interface KeycloakUserInfo {
  sub: string;
  iss: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
}

export interface KeycloakAuthStrategyOptions {
  issuer: string;
  realm: string;
}

/**
 * Vendure Admin API authentication strategy that delegates to Keycloak OIDC.
 *
 * On successful authentication:
 *  1. Validates the Keycloak access token via the userinfo endpoint
 *  2. Looks up an existing KeycloakIdentity mapped to this (issuer, subject)
 *  3. If found, returns the linked Administrator's User
 *  4. If not found, auto-provisions a new Administrator and links the KeycloakIdentity
 *
 * Per ADR-057 D3: Keycloak is identity-only, not subscription authority.
 * Email is treated as profile data; account linkage is by validated iss+sub only.
 *
 * Per INV-032: Keycloak authenticates the person; Vendure channel assignment
 * and PILOS tenant membership/roles determine what that person may do.
 */
export class KeycloakAuthenticationStrategy implements AuthenticationStrategy<KeycloakAuthData> {
  readonly name = 'keycloak';
  private externalAuthenticationService!: ExternalAuthenticationService;
  private roleService!: RoleService;
  private connection!: TransactionalConnection;
  private administratorService!: AdministratorService;
  private keycloakUserinfoUrl: string;

  constructor(private options: KeycloakAuthStrategyOptions) {
    this.keycloakUserinfoUrl = `${options.issuer}/realms/${options.realm}/protocol/openid-connect/userinfo`;
  }

  init(injector: Injector) {
    this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
    this.roleService = injector.get(RoleService);
    this.connection = injector.get(TransactionalConnection);
    this.administratorService = injector.get(AdministratorService);
  }

  defineInputType(): DocumentNode {
    return gql`
      input KeycloakAuthInput {
        token: String!
      }
    `;
  }

  async authenticate(
    ctx: RequestContext,
    data: KeycloakAuthData,
  ): Promise<User | false | string> {
    const userInfo = await this.verifyToken(data.token);
    if (!userInfo) {
      return false;
    }

    const identityRepo = this.connection.getRepository(ctx, KeycloakIdentity);
    const existingIdentity = await identityRepo.findOne({
      where: { issuer: userInfo.iss, subject: userInfo.sub },
    });

    if (existingIdentity && existingIdentity.administratorId) {
      const user = await this.findUserByAdministratorId(
        ctx,
        existingIdentity.administratorId,
      );
      if (user) {
        return user;
      }
    }

    return this.provisionAdministrator(ctx, userInfo);
  }

  private async verifyToken(token: string): Promise<KeycloakUserInfo | null> {
    try {
      const response = await fetch(this.keycloakUserinfoUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        Logger.warn(
          `Keycloak userinfo request failed: HTTP ${response.status}`,
          'KeycloakAuthenticationStrategy',
        );
        return null;
      }
      const userInfo: KeycloakUserInfo = await response.json();
      if (!userInfo || !userInfo.sub || !userInfo.iss) {
        Logger.warn(
          'Keycloak userinfo response missing sub or iss claim',
          'KeycloakAuthenticationStrategy',
        );
        return null;
      }
      if (userInfo.iss !== this.options.issuer) {
        Logger.warn(
          `Keycloak issuer mismatch: expected ${this.options.issuer}, got ${userInfo.iss}`,
          'KeycloakAuthenticationStrategy',
        );
        return null;
      }
      return userInfo;
    } catch (err) {
      Logger.error(
        `Keycloak userinfo request error: ${err}`,
        'KeycloakAuthenticationStrategy',
      );
      return null;
    }
  }

  private async provisionAdministrator(
    ctx: RequestContext,
    userInfo: KeycloakUserInfo,
  ): Promise<User | false | string> {
    const role = await this.findOrCreateKeycloakUserRole(ctx);

    const user = await this.externalAuthenticationService.createAdministratorAndUser(
      ctx,
      {
        strategy: this.name,
        externalIdentifier: userInfo.sub,
        identifier: userInfo.preferred_username || userInfo.email || userInfo.sub,
        emailAddress: userInfo.email ?? undefined,
        firstName: userInfo.given_name,
        lastName: userInfo.family_name,
        roles: [role],
      },
    );

    Logger.info(
      `Auto-provisioned Administrator for Keycloak subject ${userInfo.sub}`,
      'KeycloakAuthenticationStrategy',
    );

    await this.linkKeycloakIdentity(ctx, userInfo.iss, userInfo.sub, user);

    return user;
  }

  private async findOrCreateKeycloakUserRole(ctx: RequestContext): Promise<Role> {
    const roles = await this.roleService.findAll(ctx);
    const existing = roles.items.find((r: Role) => r.code === 'keycloak-user');
    if (existing) {
      return existing;
    }
    return this.roleService.create(ctx, {
      code: 'keycloak-user',
      description: 'Role auto-assigned to users authenticating via Keycloak',
      permissions: [],
    });
  }

  private async linkKeycloakIdentity(
    ctx: RequestContext,
    issuer: string,
    subject: string,
    user: User,
  ): Promise<void> {
    const identityRepo = this.connection.getRepository(ctx, KeycloakIdentity);
    const administratorRepo = this.connection.getRepository(ctx, Administrator);

    const administrator = await administratorRepo.findOne({
      where: { user: { id: user.id } },
    });
    const administratorId = administrator?.id;
    if (!administratorId) {
      Logger.warn(
        `Keycloak user ${subject} has no administrator record; identity not linked`,
        'KeycloakAuthenticationStrategy',
      );
      return;
    }

    let identity = await identityRepo.findOne({
      where: { issuer, subject },
    });

    if (!identity) {
      identity = new KeycloakIdentity({
        issuer,
        subject,
        administratorId: String(administratorId),
        channelId: null,
      });
      await identityRepo.save(identity);
      Logger.info(
        `Linked KeycloakIdentity (issuer=${issuer}, subject=${subject}) to Administrator ${administratorId}`,
        'KeycloakAuthenticationStrategy',
      );
    } else if (!identity.administratorId) {
      identity.administratorId = String(administratorId);
      await identityRepo.save(identity);
    }
  }

  private async findUserByAdministratorId(
    ctx: RequestContext,
    administratorId: string,
  ): Promise<User | null> {
    return this.connection.getRepository(ctx, User).findOne({
      where: { id: administratorId },
      relations: ['roles', 'roles.channels'],
    });
  }
}