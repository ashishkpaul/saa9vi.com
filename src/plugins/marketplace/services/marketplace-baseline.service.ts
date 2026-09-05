import { Injectable } from '@nestjs/common';
import {
  RequestContext,
  RequestContextService,
  SettingsStoreService,
  SettingsStoreScopes,
  TransactionalConnection,
} from '@vendure/core';
import { ProductReview } from '../../reviews/entities/product-review.entity';

const NAMESPACE = 'marketplace';

export interface BayesianBaseline {
  globalMean: number;
  baselineVersion: number;
  computedAt: Date;
  /** Durable identity of the refresh operation that established this baseline. */
  refreshGeneration?: string;
}

export type BaselineRefreshStatus = 'committed' | 'resumed' | 'superseded';

export interface BaselineRefreshResult {
  status: BaselineRefreshStatus;
  /** The authoritative baseline version after this call. */
  baselineVersion: number;
  globalMean?: number;
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
    private readonly connection: TransactionalConnection,
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
        {
          // 3D.1b Step 5: durable operation identity of the refresh that
          // established the current baseline. Persisted WITH the baseline so a
          // retried refresh job can distinguish "my previous persist" (resume
          // the same version) from "a later refresh advanced the baseline"
          // (abort — the newer generation owns convergence).
          name: 'bayesianRefreshGeneration',
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
    const [mean, version, computedAt, generation] = await Promise.all([
      this.settingsStoreService.get<{ v: number }>(ctx, `${NAMESPACE}.bayesianGlobalMean`),
      this.settingsStoreService.get<{ v: number }>(ctx, `${NAMESPACE}.bayesianBaselineVersion`),
      this.settingsStoreService.get<{ v: string }>(ctx, `${NAMESPACE}.bayesianGlobalMeanComputedAt`),
      this.settingsStoreService.get<{ v: string }>(ctx, `${NAMESPACE}.bayesianRefreshGeneration`),
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
      refreshGeneration: generation?.v,
    };
  }

  /**
   * 3D.1b Step 5 — compute the global mean rating over the APPROVED review
   * population. This live query is allowed ONLY inside the refresh operation
   * (Path B); the per-document indexing path (Path A) MUST consume the frozen
   * baseline snapshot instead (see getCurrentBaseline).
   */
  async computeGlobalMeanFromReviews(ctx: RequestContext): Promise<number> {
    const reviewRepo = this.connection.rawConnection.getRepository(ProductReview);
    const result = await reviewRepo
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'average')
      .where('review.state = :state', { state: 'approved' })
      .getRawOne();
    return parseFloat(result?.average ?? '0') || 0;
  }

  /**
   * 3D.1b Step 5 — the baseline refresh operation (Path B's persistence step).
   *
   * Establishes the next authoritative baseline {G, V+1, computedAt,
   * refreshGeneration} in the Settings Store, guarded by the durable
   * `refreshGeneration` identity so crash/retry state transitions are safe:
   *
   *  - same generation already persisted  → RESUME the same version (a retry
   *    after persisting but before enqueueing reindex does NOT create V+2)
   *  - different generation, and the authoritative version moved past the
   *    version this job claimed from → SUPERSEDED: do not overwrite; the newer
   *    generation's reindex owns convergence
   *  - different generation, claim still valid → COMMIT: persist V+1 with this
   *    generation (a retry before persistence safely establishes the next
   *    generation)
   *
   * The caller (Step 6 ScheduledTask → refresh job) generates one
   * `refreshGeneration` per scheduled execution and may optionally record the
   * version it first read (`claimedFromVersion`) in the job data, so retries
   * can detect that a later scheduled execution advanced the baseline in the
   * meantime.
   */
  async refreshBaseline(
    ctx: RequestContext,
    generation: string,
    opts?: { claimedFromVersion?: number },
  ): Promise<BaselineRefreshResult> {
    const current = await this.readRawState(ctx);

    // Case 1: this refresh operation already committed (crash-after-persist
    // retry). Reuse the same authoritative version — never advance again.
    if (current.generation === generation) {
      return {
        status: 'resumed',
        baselineVersion: current.version ?? 0,
        globalMean: current.mean,
      };
    }

    // Case 2: a NEWER refresh advanced the baseline while this job was
    // crashed/pending. An older retry must not overwrite it — the newer
    // generation's reindex owns convergence.
    if (
      opts?.claimedFromVersion != null &&
      current.version != null &&
      current.version !== opts.claimedFromVersion
    ) {
      return { status: 'superseded', baselineVersion: current.version };
    }

    // Case 3: commit the next baseline generation. G is computed live from the
    // approved-review population — permitted ONLY on this refresh path.
    const globalMean = await this.computeGlobalMeanFromReviews(ctx);
    const nextVersion = (current.version ?? 0) + 1;
    const computedAt = new Date().toISOString();

    // Persist all four state fields together; the generation identity is
    // written LAST so a crash mid-write cannot produce a new version that is
    // not identifiable as this generation.
    await this.settingsStoreService.setMany(ctx, {
      [`${NAMESPACE}.bayesianGlobalMean`]: { v: globalMean } as any,
      [`${NAMESPACE}.bayesianGlobalMeanComputedAt`]: { v: computedAt } as any,
      [`${NAMESPACE}.bayesianBaselineVersion`]: { v: nextVersion } as any,
      [`${NAMESPACE}.bayesianRefreshGeneration`]: { v: generation } as any,
    });

    // Post-write supersede check: if a concurrent refresh overwrote our
    // generation, do not claim convergence — report the authoritative state.
    const after = await this.readRawState(ctx);
    if (after.generation !== generation) {
      return { status: 'superseded', baselineVersion: after.version ?? nextVersion };
    }

    return { status: 'committed', baselineVersion: nextVersion, globalMean };
  }

  private async readRawState(ctx: RequestContext): Promise<{
    mean?: number;
    version?: number;
    computedAt?: string;
    generation?: string;
  }> {
    const [mean, version, computedAt, generation] = await Promise.all([
      this.settingsStoreService.get<{ v: number }>(ctx, `${NAMESPACE}.bayesianGlobalMean`),
      this.settingsStoreService.get<{ v: number }>(ctx, `${NAMESPACE}.bayesianBaselineVersion`),
      this.settingsStoreService.get<{ v: string }>(ctx, `${NAMESPACE}.bayesianGlobalMeanComputedAt`),
      this.settingsStoreService.get<{ v: string }>(ctx, `${NAMESPACE}.bayesianRefreshGeneration`),
    ]);
    return {
      mean: mean?.v,
      version: version?.v,
      computedAt: computedAt?.v,
      generation: generation?.v,
    };
  }
}
