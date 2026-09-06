import { Args, Query, Resolver } from '@nestjs/graphql';
import { Client } from '@elastic/elasticsearch';
import { Ctx, RequestContext, Allow, Permission, Logger } from '@vendure/core';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';

const loggerCtx = 'MarketplaceSearchResolver';

/**
 * 3D.2: typed search input. `city` was removed — it was accepted by the old
 * schema but never consumed by the resolver and no location field exists in
 * the data model.
 */
export interface MarketplaceSearchInput {
  query: string;
  subjectTags?: string[];
  priceMin?: number;
  priceMax?: number;
  startFrom?: string;
  startTo?: string;
  sessionSort?: 'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'SOONEST';
  skip?: number;
  take?: number;
}

@Resolver()
export class MarketplaceSearchResolver {
  private readonly client: Client;

  constructor(
    private readonly indexerService: MarketplaceIndexerService,
  ) {
    const node = process.env.ELASTICSEARCH_NODE || process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
    const password = process.env.ELASTICSEARCH_PASSWORD;
    const username = process.env.ELASTICSEARCH_USERNAME || 'elastic';
    this.client = new Client({
      node,
      ...(password ? { auth: { username, password } } : {}),
    });
  }

  @Query()
  @Allow(Permission.Public)
  async marketplaceSearch(
    @Ctx() ctx: RequestContext,
    @Args('input') input: MarketplaceSearchInput,
  ): Promise<{
    sessions: any[];
    instructors: any[];
    totalSessions: number;
    totalInstructors: number;
  }> {
    const skip = input.skip ?? 0;
    const take = Math.min(input.take ?? 20, 50);

    try {
      const [sessionResults, instructorResults] = await Promise.all([
        this.searchSessions(input, skip, take),
        this.searchInstructors(input, skip, take),
      ]);

      return {
        sessions: sessionResults.hits,
        instructors: instructorResults.hits,
        totalSessions: sessionResults.total,
        totalInstructors: instructorResults.total,
      };
    } catch (err: any) {
      Logger.error(`Marketplace search failed: ${err.message}`, loggerCtx, err.stack);
      return { sessions: [], instructors: [], totalSessions: 0, totalInstructors: 0 };
    }
  }

  /**
   * Shared ES range-filter clauses from MarketplaceSearchInput. Applied in
   * `filter` context so they constrain results without contributing to score.
   */
  private sessionRangeFilters(input: MarketplaceSearchInput): any[] {
    const filters: any[] = [];
    if (input.priceMin !== undefined || input.priceMax !== undefined) {
      filters.push({
        range: {
          priceInPaise: {
            ...(input.priceMin !== undefined ? { gte: input.priceMin } : {}),
            ...(input.priceMax !== undefined ? { lte: input.priceMax } : {}),
          },
        },
      });
    }
    if (input.startFrom || input.startTo) {
      filters.push({
        range: {
          startTime: {
            ...(input.startFrom ? { gte: input.startFrom } : {}),
            ...(input.startTo ? { lte: input.startTo } : {}),
          },
        },
      });
    }
    return filters;
  }

  /**
   * 3D.2 sort contract: RELEVANCE keeps the bayesian+sponsored function_score
   * ordering; PRICE_ASC/PRICE_DESC/SOONEST order on document fields with
   * _score as tiebreak so sponsored/bayesian relevance still differentiates
   * equally-priced / equally-timed sessions.
   */
  private sessionSortClauses(sort: MarketplaceSearchInput['sessionSort']): any[] {
    switch (sort) {
      case 'PRICE_ASC':
        return [{ priceInPaise: 'asc' }, { _score: 'desc' }];
      case 'PRICE_DESC':
        return [{ priceInPaise: 'desc' }, { _score: 'desc' }];
      case 'SOONEST':
        return [{ startTime: 'asc' }, { _score: 'desc' }];
      default:
        return [{ _score: { order: 'desc' } }];
    }
  }

  private async searchSessions(
    input: MarketplaceSearchInput,
    skip = 0,
    take = 20,
  ): Promise<{ hits: any[]; total: number }> {
    const must: any[] = [
      // 3D.2: fuzziness AUTO gives typo tolerance ("guitar" → "gutar").
      { multi_match: { query: input.query, fields: ['title^3', 'academyName^2', 'instructorName', 'subjectTags'], fuzziness: 'AUTO' } },
    ];

    if (input.subjectTags && input.subjectTags.length > 0) {
      must.push({ terms: { subjectTags: input.subjectTags } });
    }

    const result = await this.client.search({
      index: process.env.MARKETPLACE_SESSIONS_INDEX || 'saa9vi_marketplace_sessions',
      from: skip,
      size: take,
      query: {
        function_score: {
          query: { bool: { must, filter: this.sessionRangeFilters(input) } },
          functions: [
            { field_value_factor: { field: 'bayesianRating', factor: 1.0, modifier: 'log1p' } },
            // 3C.5 (bounded, configurable bid-boost): apply each sponsored doc's
            // per-campaign sponsorBoost instead of the former flat hardcoded
            // `weight: 3.0`. Non-sponsored docs carry sponsorBoost=1.0 (neutral),
            // so organic ranking is untouched; sponsored docs are scaled by their
            // boost, which the F7-gated indexer clamps into [SPONSORED_BOOST_MIN,
            // SPONSORED_BOOST_MAX] at write time (see SponsoredBoostConfigService).
            // `missing: 1.0` treats any legacy doc lacking the field as neutral.
            { field_value_factor: { field: 'sponsorBoost', factor: 1.0, missing: 1.0 } },
          ],
          score_mode: 'multiply',
          boost_mode: 'multiply',
        },
      },
      sort: this.sessionSortClauses(input.sessionSort),
    });

    return {
      hits: result.hits.hits.map((h: any) => h._source),
      total: typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value ?? 0,
    };
  }

  private async searchInstructors(
    input: MarketplaceSearchInput,
    skip = 0,
    take = 20,
  ): Promise<{ hits: any[]; total: number }> {
    const must: any[] = [
      { multi_match: { query: input.query, fields: ['name^3', 'bio', 'academyName^2', 'subjectTags'], fuzziness: 'AUTO' } },
    ];

    if (input.subjectTags && input.subjectTags.length > 0) {
      must.push({ terms: { subjectTags: input.subjectTags } });
    }

    const result = await this.client.search({
      index: process.env.MARKETPLACE_INSTRUCTORS_INDEX || 'saa9vi_marketplace_instructors',
      from: skip,
      size: take,
      // 3D.2: instructors with live marketplace activity rank above inactive
      // ones at equal text relevance; missing/zero fields stay neutral.
      query: {
        function_score: {
          query: { bool: { must } },
          functions: [
            {
              field_value_factor: {
                field: 'upcomingSessionsCount',
                factor: 0.1,
                modifier: 'log1p',
                missing: 0,
              },
            },
          ],
          score_mode: 'multiply',
          boost_mode: 'multiply',
        },
      },
      sort: [{ _score: { order: 'desc' } }],
    });

    return {
      hits: result.hits.hits.map((h: any) => h._source),
      total: typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value ?? 0,
    };
  }
}
