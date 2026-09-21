import { Injectable as NestInjectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { TenantTheme, ALLOWED_FONTS, isValidHexColor } from '../entities/tenant-theme.entity';

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
  constructor(private readonly connection: TransactionalConnection) {}

  /**
   * Returns the active theme for a channel, or null if none exists.
   * Called by the Shop API (myTenantTheme) — read-only, no auth beyond channel token.
   */
  async getActiveTheme(channelId: string): Promise<TenantTheme | null> {
    return this.connection.rawConnection
      .getRepository(TenantTheme)
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
   * Validates all colour values and font family before persisting.
   */
  async createTheme(ctx: RequestContext, input: ThemeInput): Promise<TenantTheme> {
    const channelId = String(ctx.channelId);
    this.validateInput(input);

    // Next version = current max + 1
    const maxVersion = await this.connection.rawConnection
      .getRepository(TenantTheme)
      .createQueryBuilder('t')
      .select('MAX(t.version)', 'max')
      .where('t.channelId = :channelId', { channelId })
      .getRawOne();
    const nextVersion = ((maxVersion?.max as number) ?? 0) + 1;

    const repo = this.connection.getRepository(ctx, TenantTheme);
    const theme = repo.create({
      channelId,
      version: nextVersion,
      status: 'draft',
      ...this.sanitizeInput(input),
    } as any);
    const saved = await repo.save(theme) as unknown as TenantTheme;
    Logger.info(`TenantTheme v${nextVersion} created (draft) for channel ${channelId}`, loggerCtx);
    return saved;
  }

  /**
   * Updates an existing DRAFT or ACTIVE theme.
   * Only themes owned by the current channel may be updated (INV-025).
   */
  async updateTheme(ctx: RequestContext, id: ID, input: ThemeInput): Promise<TenantTheme> {
    const channelId = String(ctx.channelId);
    this.validateInput(input);

    const repo = this.connection.getRepository(ctx, TenantTheme);
    const theme = await repo.findOne({ where: { id: id as any, channelId } });
    if (!theme) {
      throw new Error(`TenantTheme ${id} not found for channel ${channelId}`);
    }
    if (theme.status === 'archived') {
      throw new Error(`Cannot update an archived theme. Create a new draft or roll back to this version.`);
    }

    Object.assign(theme, this.sanitizeInput(input));
    const saved = await repo.save(theme);
    Logger.info(`TenantTheme ${id} (v${theme.version}) updated for channel ${channelId}`, loggerCtx);
    return saved;
  }

  /**
   * Publishes a DRAFT theme, making it ACTIVE.
   *
   * - Archives the current ACTIVE theme (if any).
   * - Sets the target theme to 'active'.
   * Both writes happen in the same transaction so there is never a moment
   * with zero or two active themes.
   */
  async publishTheme(ctx: RequestContext, id: ID): Promise<TenantTheme> {
    const channelId = String(ctx.channelId);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, TenantTheme);

      const target = await repo.findOne({ where: { id: id as any, channelId } });
      if (!target) throw new Error(`TenantTheme ${id} not found for channel ${channelId}`);
      if (target.status === 'active') return target; // already active
      if (target.status === 'archived') throw new Error(`Cannot publish an archived theme.`);

      // Archive the current active theme if one exists
      const current = await repo.findOne({ where: { channelId, status: 'active' } });
      if (current) {
        current.status = 'archived';
        await repo.save(current);
      }

      target.status = 'active';
      const saved = await repo.save(target);
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
   */
  async rollbackTheme(ctx: RequestContext, id: ID): Promise<TenantTheme> {
    const channelId = String(ctx.channelId);

    return this.connection.withTransaction(ctx, async (txCtx) => {
      const repo = this.connection.getRepository(txCtx, TenantTheme);

      const target = await repo.findOne({ where: { id: id as any, channelId } });
      if (!target) throw new Error(`TenantTheme ${id} not found for channel ${channelId}`);
      if (target.status === 'active') return target;
      if (target.status === 'draft') throw new Error(`Use publishTheme to activate a draft.`);

      const current = await repo.findOne({ where: { channelId, status: 'active' } });
      if (current) {
        current.status = 'archived';
        await repo.save(current);
      }

      target.status = 'active';
      const saved = await repo.save(target);
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
   */
  async resetTheme(ctx: RequestContext): Promise<boolean> {
    const channelId = String(ctx.channelId);
    const repo = this.connection.getRepository(ctx, TenantTheme);
    const current = await repo.findOne({ where: { channelId, status: 'active' } });
    if (!current) return true;
    current.status = 'archived';
    await repo.save(current);
    Logger.info(`TenantTheme reset for channel ${channelId} — storefront uses platform default`, loggerCtx);
    return true;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validateInput(input: ThemeInput): void {
    const colorFields: (keyof ThemeInput)[] = [
      'primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor',
    ];
    for (const field of colorFields) {
      const val = input[field] as string | null | undefined;
      if (val != null && !isValidHexColor(val)) {
        throw new Error(
          `Invalid colour value for ${field}: "${val}". Must be a hex colour (#RGB, #RRGGBB, or #RRGGBBAA).`,
        );
      }
    }
    if (input.fontFamily != null && !(ALLOWED_FONTS as readonly string[]).includes(input.fontFamily)) {
      throw new Error(
        `Font family "${input.fontFamily}" is not in the allowed set: ${ALLOWED_FONTS.join(', ')}.`,
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
