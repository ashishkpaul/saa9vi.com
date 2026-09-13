import { Query, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, Logger, RequestContext } from '@vendure/core';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';
import { MarketplaceBaselineService } from '../services/marketplace-baseline.service';
import { randomUUID } from 'crypto';

const loggerCtx = 'MarketplaceAdminResolver';

@Resolver()
export class MarketplaceAdminResolver {
  constructor(
    private readonly indexerService: MarketplaceIndexerService,
    private readonly baselineService: MarketplaceBaselineService,
  ) {}

  @Mutation()
  @Allow(Permission.SuperAdmin)
  async marketplaceRefreshBaseline(@Ctx() ctx: RequestContext): Promise<boolean> {
    try {
      const generation = randomUUID();
      const result = await this.baselineService.refreshBaseline(ctx, generation);
      Logger.info(
        `On-demand baseline refresh: status=${result.status} version=${result.baselineVersion}` +
          (result.globalMean != null ? ` mean=${result.globalMean}` : ''),
        loggerCtx,
      );
      return result.status === 'committed' || result.status === 'resumed';
    } catch (err: any) {
      Logger.error(`Baseline refresh failed: ${err.message}`, loggerCtx, err.stack);
      return false;
    }
  }

  @Query()
  @Allow(Permission.SuperAdmin)
  async marketplaceFullReindex(@Ctx() ctx: RequestContext): Promise<boolean> {
    try {
      await this.indexerService.fullReindex(ctx);
      return true;
    } catch (err: any) {
      Logger.error(`Marketplace full reindex failed: ${err.message}`, loggerCtx, err.stack);
      return false;
    }
  }
}
