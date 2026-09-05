import { Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, Logger, RequestContext } from '@vendure/core';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';

const loggerCtx = 'MarketplaceAdminResolver';

@Resolver()
export class MarketplaceAdminResolver {
  constructor(
    private readonly indexerService: MarketplaceIndexerService,
  ) {}

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
