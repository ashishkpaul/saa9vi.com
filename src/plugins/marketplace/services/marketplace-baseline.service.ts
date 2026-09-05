import { Injectable, Logger } from '@nestjs/common';
import {
  RequestContext,
  RequestContextService,
  SettingsStoreService,
  SettingsStoreScopes,
} from '@vendure/core';

const loggerCtx = 'MarketplaceBaselineService';

const NAMESPACE = 'marketplace';

export interface BayesianBaseline {
  globalMean: number;
  baselineVersion: number;
  computedAt: Date;
}

/**
 * Manages the authoritative Bayesian baseline stored in the Vendure Settings Store.
 *
 * 3D.1a/3D.1b contract: the global prior G is a frozen periodic baseline,
 * not a live query on ProductReview. This service is the single source of
 * truth for the current baseline snapshot { G, V, computedAt }.
 */
@Injectable()
export class MarketplaceBaselineService {
  constructor(
    private readonly settingsStoreService: SettingsStoreService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Register the baseline fields in the Settings Store.
   * Called from plugin configuration.
   */
  registerFields(): void {
    this.settingsStoreService.register({
      namespace: NAMESPACE,
      fields: [
        {
          name: 'bayesianGlobalMean',
          scope: SettingsStoreScopes.global,
        },
        {
          name: 'bayesianBaselineVersion',
          scope: SettingsStoreScopes.global,
        },
        {
          name: 'bayesianGlobalMeanComputedAt',
          scope: SettingsStoreScopes.global,
        },
      ],
    });
  }

  /**
   * Create an internal admin context for service work outside the
   * request/response cycle. Vendure's RequestContextService.create()
   * defaults to the default channel when channelOrToken is omitted.
   */
  async createInternalContext(): Promise<RequestContext> {
    return this.requestContextService.create({
      apiType: 'admin',
    });
  }

  /**
   * Get the current authoritative baseline snapshot.
   * Path A reads this instead of computing G live from ProductReview.
   */
  async getCurrentBaseline(ctx: RequestContext): Promise<BayesianBaseline> {
    const [mean, version, computedAt] = await Promise.all([
      this.settingsStoreService.get<number>(ctx, `${NAMESPACE}.bayesianGlobalMean`),
      this.settingsStoreService.get<number>(ctx, `${NAMESPACE}.bayesianBaselineVersion`),
      this.settingsStoreService.get<string>(ctx, `${NAMESPACE}.bayesianGlobalMeanComputedAt`),
    ]);

    return {
      globalMean: mean ?? 0,
      baselineVersion: version ?? 0,
      computedAt: computedAt ? new Date(computedAt) : new Date(0),
    };
  }
}
