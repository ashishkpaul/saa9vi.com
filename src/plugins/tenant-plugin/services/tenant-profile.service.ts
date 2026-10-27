import { Injectable } from '@nestjs/common';
import { EventBus, IllegalOperationError, RequestContext, TransactionalConnection, ChannelService } from '@vendure/core';
import { ID } from '@vendure/common/lib/shared-types';
import { TenantProfile } from '../entities/tenant-profile.entity';
import { DomainChannelResolverService } from './domain-channel-resolver.service';
import { TenantProfileUpdatedEvent, TenantRegisteredEvent } from '../events/tenant-events';

const SAA9VI_ROOT_DOMAIN = 'saa9vi.com';

/**
 * The seller customDomain field is only for a seller-owned domain. Saa9vi
 * platform hosts must be configured separately and must never be assigned to
 * a seller Channel through the custom-domain mapping path.
 */
function assertSellerOwnedCustomDomain(domain: string | null | undefined): void {
  if (!domain) return;

  let hostname: string;
  try {
    const trimmed = domain.trim();
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    throw new IllegalOperationError('Seller custom domain must be a valid hostname.');
  }

  if (
    hostname === SAA9VI_ROOT_DOMAIN ||
    hostname.endsWith(`.${SAA9VI_ROOT_DOMAIN}`)
  ) {
    throw new IllegalOperationError(
      'Seller custom domains must not use saa9vi.com or any of its subdomains.',
    );
  }
}

@Injectable()
export class TenantProfileService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly domainResolver: DomainChannelResolverService,
    private readonly eventBus: EventBus,
  ) {}

  async findByChannelId(ctx: RequestContext, channelId: ID): Promise<TenantProfile | null> {
    return this.connection
      .getRepository(ctx, TenantProfile)
      .findOne({ where: { channelId } });
  }

  async findByChannelIdOrThrow(ctx: RequestContext, channelId: ID): Promise<TenantProfile> {
    const profile = await this.findByChannelId(ctx, channelId);
    if (!profile) {
      throw new Error(`TenantProfile not found for channel ${channelId}`);
    }
    return profile;
  }

  /**
   * Lowercase alphanumeric+dash slug derived from an arbitrary display name.
   * Deterministic so the same businessName always yields the same base slug;
   * uniqueness is resolved separately by suffixing.
   */
  private slugify(input: string): string {
    const base = (input || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
    return base || 'tenant';
  }

  /**
   * Platform-global uniqueness lookup for tenantSlug. The slug remains a
   * stable internal/marketplace identifier and must be unique across channels.
   * The unique index is the ultimate database guard; this lookup selects a
   * candidate and the retry loop in create() handles registration races.
   */
  private tenantSlugRepo(ctx: RequestContext) {
    return this.connection.rawConnection.getRepository(TenantProfile);
  }

  /** Detect a PostgreSQL unique-violation specifically on tenantSlug. */
  private isUniqueSlugViolation(e: any): boolean {
    // Prefer the machine-readable SQLSTATE (23505 = unique_violation),
    // narrowed to the tenantSlug index so a customDomain violation is not
    // misattributed; fall back to the human-readable message for drivers
    // that lose the code/constraint metadata.
    if (e?.code === '23505') {
      const meta = String(e?.constraint || '') + String(e?.detail || '');
      return !meta || /tenantslug/i.test(meta);
    }
    const msg = String(e?.message || '') + String(e?.detail || '');
    return /duplicate key/i.test(msg) && msg.includes('tenantSlug');
  }

  /**
   * B-2.1: persist the TenantProfile, retrying derived-slug collisions with
   * the next -N suffix. Each attempt runs inside a SAVEPOINT when the
   * surrounding context has an active transaction (e.g. a @Transaction()
   * resolver), because PostgreSQL aborts the whole transaction on a failed
   * INSERT — ROLLBACK TO SAVEPOINT clears that so the retry can proceed on
   * the same connection. Without an active transaction (the current
   * registerNewTenant case — no @Transaction decorator, so Vendure's
   * TransactionInterceptor does not open one), each save() autocommits and
   * retries are naturally independent; the savepoint is skipped.
   */
  private async saveWithSlugRetry(
    ctx: RequestContext,
    profile: TenantProfile,
    input: Partial<TenantProfile>,
  ): Promise<TenantProfile> {
    const repo = this.connection.getRepository(ctx, TenantProfile);
    const queryRunner = repo.manager.queryRunner;
    const inTransaction = !!queryRunner && queryRunner.isTransactionActive;
    let attempt = 2;
    for (;;) {
      if (inTransaction) {
        await queryRunner!.query('SAVEPOINT tenant_slug_attempt');
      }
      try {
        const saved = await repo.save(profile);
        if (inTransaction) {
          await queryRunner!.query('RELEASE SAVEPOINT tenant_slug_attempt');
        }
        return saved;
      } catch (e: any) {
        if (inTransaction) {
          await queryRunner!.query('ROLLBACK TO SAVEPOINT tenant_slug_attempt').catch(() => undefined);
        }
        if (!this.isUniqueSlugViolation(e) || input.tenantSlug || attempt > 999) {
          throw e;
        }
        profile.tenantSlug = `${this.slugify(input.businessName || '')}-${attempt++}`;
      }
    }
  }

  /**
   * Derive a unique tenantSlug candidate for a new tenant (G1 decision).
   * Suffixes -2, -3, ... on collision so self-serve registration rarely
   * fails on a popular business name. This is only a candidate check: under
   * concurrent registration two callers can pass it and race at save —
   * create() retries on the unique violation (B-2.1).
   */
  private async findFreeSlugCandidate(
    ctx: RequestContext,
    base: string,
    startSuffix = 2,
  ): Promise<string> {
    const repo = this.tenantSlugRepo(ctx);
    let candidate = base;
    for (let i = startSuffix; i <= 999; i++) {
      const clash = await repo.findOne({ where: { tenantSlug: candidate } });
      if (!clash) {
        return candidate;
      }
      candidate = `${base}-${i}`;
    }
    throw new Error(`Unable to derive a unique tenantSlug from "${base}"`);
  }

  /** Validate/normalize an explicitly supplied slug and reject collisions. */
  private async assertSlugAvailable(ctx: RequestContext, slug: string): Promise<string> {
    const normalized = this.slugify(slug);
    const clash = await this.tenantSlugRepo(ctx).findOne({
      where: { tenantSlug: normalized },
    });
    if (clash) {
      throw new Error(`tenantSlug "${normalized}" is already in use`);
    }
    return normalized;
  }

  async create(ctx: RequestContext, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const channelId = input.channelId || ctx.channelId as ID;
    if (!channelId) {
      throw new Error('channelId is required');
    }
    assertSellerOwnedCustomDomain(input.customDomain);
    const existing = await this.findByChannelId(ctx, channelId);
    if (existing) {
      throw new Error(`TenantProfile already exists for channel ${channelId}`);
    }
    const profile = new TenantProfile({ ...input, channelId });

    // Resolve the tenant slug used as a stable internal/marketplace identifier.
    // Explicitly supplied slugs are validated; otherwise a deterministic unique
    // slug is derived from businessName before the profile is saved.
    if (input.tenantSlug) {
      profile.tenantSlug = await this.assertSlugAvailable(ctx, input.tenantSlug);
    } else {
      profile.tenantSlug = await this.findFreeSlugCandidate(ctx, this.slugify(input.businessName || ''));
    }

    // Save first to get an ID, then assign to channel.
    // Concurrency-safe allocation (B-2.1, transaction-aware): the preliminary
    // candidate check cannot eliminate the register-vs-register race, so a
    // unique violation on tenantSlug triggers reallocation with the next -N
    // suffix and a retry. Each attempt is wrapped in a PostgreSQL SAVEPOINT
    // when a transaction is active, so the aborted statement never poisons
    // the outer registration transaction (the plain-retry version of this
    // loop would fail with 25P02 "transaction aborted" if registerNewTenant
    // ever gains @Transaction()). Outside a transaction every save()
    // autocommits, so retries are naturally independent. Explicitly supplied
    // slugs are never auto-renamed — the caller gets the error instead.
    const saved = await this.saveWithSlugRetry(ctx, profile, input);

    // Use assignToChannels with an explicit channelId rather than
    // assignToCurrentChannel, which reads ctx.channelId and would silently
    // assign to the wrong channel when ctx is scoped to a different channel
    // (e.g. the default Shop API channel during self-serve registration).
    // assignToChannels uses the same transactional ctx so it sees the Channel
    // row that was just inserted in the same open transaction — no second
    // RequestContext needed (fixes BUG-021 / root cause from TP-004).
    await this.channelService.assignToChannels(ctx, TenantProfile, saved.id, [channelId]);

    // Sync custom domain to Redis if set
    if (saved.customDomain) {
      const channel = await this.connection.getRepository(ctx, 'Channel').findOne({ where: { id: channelId } });
      if (channel) {
        await this.domainResolver.setMapping(saved.customDomain, (channel as any).token);
      }
    }

    // Notify academy-provisioning consumers independently of hostname routing.
    // create() always derives/validates tenantSlug before persistence. BBB uses
    // the slug to provision the organization's identity/default rooms, and the
    // subscription plugin provisions the free plan. No Saa9vi seller-hostname
    // mapping is created or required for this event.
    this.eventBus.publish(
      new TenantRegisteredEvent(
        ctx,
        String(saved.id),
        String(channelId),
        saved.tenantSlug,
        saved.businessName,
      ),
    );

    return saved;
  }

  async update(ctx: RequestContext, channelId: ID, input: Partial<TenantProfile>): Promise<TenantProfile> {
    const profile = await this.findByChannelIdOrThrow(ctx, channelId);
    assertSellerOwnedCustomDomain(input.customDomain);
    // tenantSlug is immutable because it is a stable internal/marketplace
    // identifier. Reject rename attempts explicitly rather than silently
    // discarding them or changing existing references.
    if (input.tenantSlug && input.tenantSlug !== profile.tenantSlug) {
      throw new IllegalOperationError(
        `tenantSlug is immutable: "${profile.tenantSlug}" cannot be renamed to "${input.tenantSlug}"`,
      );
    }
    delete input.tenantSlug;
    const oldDomain = profile.customDomain;
    const updatedFields = Object.keys(input);
    Object.assign(profile, input);
    const saved = await this.connection.getRepository(ctx, TenantProfile).save(profile);

    // Sync custom domain changes to Redis
    const newDomain = saved.customDomain;
    if (oldDomain !== newDomain) {
      if (oldDomain) {
        await this.domainResolver.removeMapping(oldDomain);
      }
      if (newDomain) {
        const channel = await this.connection.getRepository(ctx, 'Channel').findOne({ where: { id: channelId } });
        if (channel) {
          await this.domainResolver.setMapping(newDomain, (channel as any).token);
        }
      }
    }

    // Gate 1.4 (F5): notify marketplace consumers so every marketplace
    // document belonging to this channel can be bulk-invalidated/reindexed.
    this.eventBus.publish(
      new TenantProfileUpdatedEvent(String(saved.id), String(channelId), updatedFields),
    );

    return saved;
  }
}
