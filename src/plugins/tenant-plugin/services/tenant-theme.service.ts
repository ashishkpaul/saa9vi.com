import { Injectable as NestInjectable } from '@nestjs/common';
import {
  Asset,
  ID,
  Logger,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { Repository } from 'typeorm';
import { TenantTheme, ALLOWED_FONTS, isValidHexColor } from '../entities/tenant-theme.entity';
import { TenantCommercialEligibilityService } from './tenant-commercial-eligibility.service';

const loggerCtx = 'TenantThemeService';

export interface ThemeInput {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  fontFamily?: string | null;
  logoAssetId?: string | null;
  displayName?: string | null;
}

@NestInjectable()
export class TenantThemeService {
  constructor(
    private readonly connection: TransactionalConnection,
    private readonly eligibility: TenantCommercialEligibilityService,
  ) {}

  /**
   * Returns the active theme for a channel, or null if none exists.
   *
   * Public Shop API surface (myTenantTheme): the storefront needs the theme
   * before any customer authentication, so the read is not auth-gated — but it
   * IS entitlement-gated. `whitelabelEnabled` controls whether tenant-specific
   * branding is *usable*, not merely whether it can be edited, so a tenant that
   * loses the entitlement stops being served its theme and falls back to the
   * platform default (ADR-043 §2). Public access and commercial entitlement are
   * different questions.
   *
   * `channelId` always comes from the resolved request channel — never from
   * client input. At most one row can match (UNIQUE(channelId) WHERE
   * status='active'), so the result is deterministic.
   */
  async getActiveTheme(ctx: RequestContext): Promise<TenantTheme | null> {
    if (!(await this.eligibility.canUseWhitelabel(ctx))) return null;

    const channelId = String(ctx.channelId);
    return this.connection
      .getRepository(ctx, TenantTheme)
      .findOne({ where: { channelId, status: 'active' } });
  }

  /**
   * Returns the theme for a channel by ID.
   * Only returns themes belonging to the given channel (INV-025).
   */
  async findById(ctx: RequestContext, id: ID): Promise<TenantTheme | null> {
    const channelId = String(ctx.channelId);
    return this.connection
      .getRepository(ctx, TenantTheme)
      .findOne({ where: { id: id as any, channelId } });
  }

  /**
   * Lists all themes for the current channel, newest first.
   */
  async listByChannel(ctx: RequestContext): Promise<TenantTheme[]> {
    const channelId = String(ctx.channelId);
    const items = await this.connection
      .getRepository(ctx, TenantTheme)
      .find({ where: { channelId }, order: { version: 'DESC' } });
    return items;
  }

  /**
   * Creates a new DRAFT theme for the channel.
   *
   * Requires the white-label entitlement (ADR-043 §2). Validates colour values,
   * font family and logo asset ownership before persisting. Version allocation
   * (MAX(version) + 1) and the insert happen in one transaction serialized by a
   * per-channel advisory lock, so two concurrent drafts cannot collide on
   * UNIQUE(channelId, version).
   */
  async createTheme(ctx: RequestContext, input: ThemeInput): Promise<TenantTheme> {
    await this.eligibility.assertCanUseWhitelabel(ctx);

    const channelId = String(ctx.channelId);
    await this.validateInput(ctx, input);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      await this.lockChannelVersionAllocation(txCtx, channelId);
      const repo = this.connection.getRepository(txCtx, TenantTheme);
      const nextVersion = await this.nextVersion(repo, channelId);

      const theme = repo.create({
        channelId,
        version: nextVersion,
        status: 'draft',
        ...this.sanitizeInput(input),
      } as any);
      const saved = await repo.save(theme) as unknown as TenantTheme;
      Logger.info(`TenantTheme v${nextVersion} created (draft) for channel ${channelId}`, loggerCtx);
      return saved;
    });
  }

  /**
   * Updates an existing DRAFT theme.
   *
   * Published versions are immutable (ADR-043): an 'active' or 'archived' row
   * cannot be edited, because rewriting it would destroy the version's history
   * and make rollback non-deterministic — the previous release would still be
   * labelled v2 while holding different values.
   *
   * To change the live theme: clone the current version into a new draft
   * (createDraftFromVersion), edit the draft, then publish it. Publishing
   * archives the version it replaces.
   *
   * Only themes owned by the current channel may be updated (INV-025), and the
   * tenant must still hold the white-label entitlement (ADR-043 §2).
   */
  async updateTheme(ctx: RequestContext, id: ID, input: ThemeInput): Promise<TenantTheme> {
    await this.eligibility.assertCanUseWhitelabel(ctx);

    const channelId = String(ctx.channelId);
    await this.validateInput(ctx, input);

    const repo = this.connection.getRepository(ctx, TenantTheme);
    const theme = await repo.findOne({ where: { id: id as any, channelId } });
    if (!theme) {
      throw new UserInputError(`TenantTheme ${id} not found for channel ${channelId}`);
    }
    if (theme.status !== 'draft') {
      throw new UserInputError(
        `TenantTheme ${id} is '${theme.status}' and immutable. Only draft themes can be edited — ` +
          `create a draft from the current version and publish that instead.`,
      );
    }

    Object.assign(theme, this.sanitizeInput(input));
    const saved = await repo.save(theme);
    Logger.info(`TenantTheme ${id} (v${theme.version}) draft updated for channel ${channelId}`, loggerCtx);
    return saved;
  }

  /**
   * Clones an ACTIVE or ARCHIVED version into a new DRAFT at the next version.
   *
   * This is the "edit the live theme" building block:
   *   active v3 → createDraftFromVersion → draft v4 → updateTheme(v4) → publish v4
   * which archives v3. Together with the draft-only update rule it guarantees
   * that every version holds a fixed value set, so rollback restores exactly
   * what was live.
   *
   * Deliberately NOT exposed on the Admin GraphQL API yet: clients express
   * intent ("edit current theme") while the API surface stays free of version
   * mechanics. Used internally, and covered by the theme e2e suite.
   *
   * Gated by the white-label entitlement even though it has no resolver: it
   * still creates tenant theming state, so a future resolver or job must not be
   * able to bypass the entitlement boundary through it.
   */
  async createDraftFromVersion(ctx: RequestContext, id: ID): Promise<TenantTheme> {
    await this.eligibility.assertCanUseWhitelabel(ctx);

    const channelId = String(ctx.channelId);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, TenantTheme);

      const source = await repo.findOne({ where: { id: id as any, channelId } });
      if (!source) {
        throw new UserInputError(`TenantTheme ${id} not found for channel ${channelId}`);
      }
      if (source.status === 'draft') {
        throw new UserInputError(
          `TenantTheme ${id} is already a draft — update it directly instead of cloning it.`,
        );
      }

      await this.lockChannelVersionAllocation(txCtx, channelId);
      const nextVersion = await this.nextVersion(repo, channelId);

      const draft = repo.create({
        channelId,
        version: nextVersion,
        status: 'draft',
        primaryColor: source.primaryColor,
        secondaryColor: source.secondaryColor,
        accentColor: source.accentColor,
        backgroundColor: source.backgroundColor,
        textColor: source.textColor,
        fontFamily: source.fontFamily,
        logoAssetId: source.logoAssetId,
        displayName: source.displayName,
      } as any);
      const saved = (await repo.save(draft)) as unknown as TenantTheme;
      Logger.info(
        `TenantTheme v${nextVersion} (draft) cloned from v${source.version} (${source.status}) for channel ${channelId}`,
        loggerCtx,
      );
      return saved;
    });
  }

  /**
   * Publishes a DRAFT theme, making it ACTIVE.
   *
   * - Archives the current ACTIVE theme (if any).
   * - Sets the target theme to 'active'.
   *
   * Both writes happen in the same transaction, and the current-active read
   * takes a row lock so a concurrent publisher waits rather than interleaving.
   * The partial unique index (UNIQUE(channelId) WHERE status='active') is the
   * final authority: a losing transaction fails closed with 23505 instead of
   * silently leaving two active themes.
   *
   * Requires the white-label entitlement (ADR-043 §2): publishing ACTIVATES
   * tenant branding.
   */
  async publishTheme(ctx: RequestContext, id: ID): Promise<TenantTheme> {
    await this.eligibility.assertCanUseWhitelabel(ctx);

    const channelId = String(ctx.channelId);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, TenantTheme);

      const target = await repo.findOne({ where: { id: id as any, channelId } });
      if (!target) throw new UserInputError(`TenantTheme ${id} not found for channel ${channelId}`);
      if (target.status === 'active') return target; // already active
      if (target.status === 'archived') {
        throw new UserInputError(`Cannot publish an archived theme. Roll back to it instead.`);
      }

      // Archive the current active theme if one exists
      const current = await repo.findOne({
        where: { channelId, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });
      if (current) {
        current.status = 'archived';
        await repo.save(current);
      }

      target.status = 'active';
      const saved = await this.guardSingleActive(() => repo.save(target));
      Logger.info(
        `TenantTheme ${id} (v${target.version}) published as active for channel ${channelId}`,
        loggerCtx,
      );
      return saved;
    });
  }

  /**
   * Rolls back to a previously archived theme.
   *
   * - Archives the current ACTIVE theme.
   * - Restores the target ARCHIVED theme to 'active'.
   *
   * Rollback is deterministic because published versions are immutable: the
   * archived row still holds exactly the values that were live when it was
   * active. Hardened the same way as publishTheme (row lock + DB-arbitrated
   * single-active).
   *
   * Requires the white-label entitlement (ADR-043 §2). Rollback is an
   * ACTIVATION operation — it sets an archived version back to 'active' — so
   * leaving it ungated would let a tenant whose entitlement has lapsed
   * re-enable tenant branding and defeat the plan gate.
   */
  async rollbackTheme(ctx: RequestContext, id: ID): Promise<TenantTheme> {
    await this.eligibility.assertCanUseWhitelabel(ctx);

    const channelId = String(ctx.channelId);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, TenantTheme);

      const target = await repo.findOne({ where: { id: id as any, channelId } });
      if (!target) throw new UserInputError(`TenantTheme ${id} not found for channel ${channelId}`);
      if (target.status === 'active') return target;
      if (target.status === 'draft') {
        throw new UserInputError(`Use publishTheme to activate a draft.`);
      }

      const current = await repo.findOne({
        where: { channelId, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });
      if (current) {
        current.status = 'archived';
        await repo.save(current);
      }

      target.status = 'active';
      const saved = await this.guardSingleActive(() => repo.save(target));
      Logger.info(
        `TenantTheme ${id} (v${target.version}) rolled back to active for channel ${channelId}`,
        loggerCtx,
      );
      return saved;
    });
  }

  /**
   * Resets the tenant theme by archiving the active theme.
   * The storefront falls back to the Saa9vi default theme when no active theme exists.
   *
   * Self-contained transaction (does not rely on the resolver's @Transaction)
   * so it stays correct when called from a deletion handler or a job.
   *
   * Deliberately NOT entitlement-gated (ADR-043 §2): reset only REMOVES tenant
   * branding and restores the platform default, so it must stay available as
   * the operational escape hatch even after a tenant's entitlement lapses.
   */
  async resetTheme(ctx: RequestContext): Promise<boolean> {
    const channelId = String(ctx.channelId);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, TenantTheme);
      const current = await repo.findOne({
        where: { channelId, status: 'active' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) return true;

      current.status = 'archived';
      await repo.save(current);
      Logger.info(`TenantTheme reset for channel ${channelId} — storefront uses platform default`, loggerCtx);
      return true;
    });
  }

  // ── Version allocation & concurrency ──────────────────────────────────────

  /**
   * Serializes version allocation for one channel for the remainder of the
   * caller's transaction. `pg_advisory_xact_lock` is released automatically on
   * COMMIT/ROLLBACK, and because `getRepository(ctx, …)` is bound to the
   * transaction's EntityManager the lock is held on the same connection that
   * performs the insert.
   *
   * Postgres-specific, matching this platform's generated migration SQL
   * (SERIAL / now()). Two different channelIds may hash to the same int4, in
   * which case their allocators serialize unnecessarily — never incorrectly.
   */
  private async lockChannelVersionAllocation(ctx: RequestContext, channelId: string): Promise<void> {
    const repo = this.connection.getRepository(ctx, TenantTheme);
    await repo.manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [channelId]);
  }

  /** MAX(version) + 1 for the channel. Caller must hold the channel lock. */
  private async nextVersion(repo: Repository<TenantTheme>, channelId: string): Promise<number> {
    const row = await repo
      .createQueryBuilder('t')
      .select('MAX(t.version)', 'max')
      .where('t.channelId = :channelId', { channelId })
      .getRawOne();
    return ((row?.max as number) ?? 0) + 1;
  }

  /**
   * Translates a 23505 from the single-active partial unique index into a
   * domain error, so a concurrent publish surfaces as a retryable conflict
   * rather than leaking a raw driver error. Mirrors the repo-wide
   * `err.code === '23505'` convention (commission-ledger, ad-wallet).
   */
  private async guardSingleActive<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new UserInputError(
          'Another theme was published for this channel concurrently. Reload and retry.',
        );
      }
      throw err;
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private async validateInput(ctx: RequestContext, input: ThemeInput): Promise<void> {
    const colorFields: (keyof ThemeInput)[] = [
      'primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor',
    ];
    for (const field of colorFields) {
      const val = input[field] as string | null | undefined;
      if (val != null && !isValidHexColor(val)) {
        throw new UserInputError(
          `Invalid colour value for ${field}: "${val}". Must be a hex colour (#RGB, #RRGGBB, or #RRGGBBAA).`,
        );
      }
    }
    if (input.fontFamily != null && !(ALLOWED_FONTS as readonly string[]).includes(input.fontFamily)) {
      throw new UserInputError(
        `Font family "${input.fontFamily}" is not in the allowed set: ${ALLOWED_FONTS.join(', ')}.`,
      );
    }
    if (input.logoAssetId != null) {
      await this.assertLogoAssetOwnedByChannel(ctx, input.logoAssetId);
    }
  }

  /**
   * ADR-043 / INV-025: a theme may only reference a logo asset owned by the
   * SAME channel. Without this check a tenant admin could point their own
   * storefront at another tenant's asset simply by supplying its id.
   *
   * Soft-deleted assets are excluded automatically — Asset is SoftDeletable,
   * so TypeORM filters `deletedAt` rows out of findOne.
   */
  private async assertLogoAssetOwnedByChannel(
    ctx: RequestContext,
    logoAssetId: string,
  ): Promise<void> {
    const channelId = String(ctx.channelId);
    const asset = await this.connection
      .getRepository(ctx, Asset)
      .findOne({ where: { id: logoAssetId as any }, relations: ['channels'] });

    if (!asset) {
      throw new UserInputError(`Logo asset ${logoAssetId} does not exist.`);
    }
    const ownedByChannel = (asset.channels ?? []).some((c) => String(c.id) === channelId);
    if (!ownedByChannel) {
      throw new UserInputError(
        `Logo asset ${logoAssetId} does not belong to this tenant channel. ` +
          `A tenant theme may only reference assets owned by its own channel.`,
      );
    }
  }

  private sanitizeInput(input: ThemeInput): Partial<TenantTheme> {
    const out: Partial<TenantTheme> = {};
    const colorFields: (keyof ThemeInput)[] = [
      'primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor',
    ];
    for (const f of colorFields) {
      if (f in input) (out as any)[f] = (input as any)[f] ?? null;
    }
    if ('fontFamily' in input) out.fontFamily = input.fontFamily ?? null;
    if ('logoAssetId' in input) out.logoAssetId = input.logoAssetId ?? null;
    if ('displayName' in input) out.displayName = input.displayName ?? null;
    return out;
  }
}
