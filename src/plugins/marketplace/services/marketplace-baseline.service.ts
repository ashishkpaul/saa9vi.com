import { Injectable } from '@nestjs/common';
import {
  RequestContext,
  RequestContextService,
  SettingsStoreService,
  SettingsStoreScopes,
} from '@vendure/core';

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
   *
   * 3D.1b fail-closed rule: if no baseline has ever been established
   * (scheduled refresh not yet run), this THROWS rather than returning a
   * placeholder { G: 0, V: 0 } — a placeholder would produce a false
   * "converged" ES document at version 0. indexSession() lets the throw
   * propagate, so the job is rejected and retried until a baseline exists.
   */
  async getCurrentBaseline(ctx: RequestContext): Promise<BayesianBaseline> {
    // Settings Store values must be JsonCompatible objects (primitives are
    // rejected by the JsonCompatible<T> type), so each field is stored as { v }.
    const [mean, version, computedAt] = await Promise.all([
      this.settingsStoreService.get<{ v: number }>(ctx, `${NAMESPACE}.bayesianGlobalMean`),
      this.settingsStoreService.get<{ v: number }>(ctx, `${NAMESPACE}.bayesianBaselineVersion`),
      this.settingsStoreService.get<{ v: string }>(ctx, `${NAMESPACE}.bayesianGlobalMeanComputedAt`),
    ]);

    if (version == null || mean == null) {
      throw new Error(
        'Bayesian baseline has not been established: no globalMean/baselineVersion in Settings Store. ' +
          'Run the baseline refresh task before marketplace indexing.',
      );
    }

    return {
      globalMean: mean.v,
      baselineVersion: version.v,
      computedAt: computedAt ? new Date(computedAt.v) : new Date(0),
    };
  }
}
