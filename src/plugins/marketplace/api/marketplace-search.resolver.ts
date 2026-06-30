import { Args, Query, Resolver } from '@nestjs/graphql';
import { Client } from '@elastic/elasticsearch';
import { Ctx, RequestContext, Allow, Permission, Logger } from '@vendure/core';
import { MarketplaceIndexerService } from '../services/marketplace-indexer.service';

const loggerCtx = 'MarketplaceSearchResolver';

@Resolver()
export class MarketplaceSearchResolver {
  private readonly client: Client;

  constructor(
    private readonly indexerService: MarketplaceIndexerService,
  ) {
    const node = process.env.ELASTICSEARCH_NODE || process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
    const password = process.env.ELASTICSEARCH_PASSWORD;
    this.client = new Client({
      node,
      ...(password ? { auth: { username: 'elastic', password } } : {}),
    });
  }

  @Query()
  @Allow(Permission.Public)
  async marketplaceSearch(
    @Ctx() ctx: RequestContext,
    @Args('input') input: { query: string; subjectTags?: string[]; city?: string; skip?: number; take?: number },
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
        this.searchSessions(input.query, input.subjectTags, skip, take),
        this.searchInstructors(input.query, input.subjectTags, skip, take),
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

  @Query()
  @Allow(Permission.SuperAdmin)
  async marketplaceFullReindex(): Promise<boolean> {
    try {
      await this.indexerService.fullReindex();
      return true;
    } catch (err: any) {
      Logger.error(`Marketplace full reindex failed: ${err.message}`, loggerCtx, err.stack);
      return false;
    }
  }

  private async searchSessions(
    query: string,
    subjectTags?: string[],
    skip = 0,
    take = 20,
  ): Promise<{ hits: any[]; total: number }> {
    const must: any[] = [
      { multi_match: { query, fields: ['title^3', 'academyName^2', 'instructorName', 'subjectTags'] } },
    ];

    if (subjectTags && subjectTags.length > 0) {
      must.push({ terms: { subjectTags } });
    }

    const result = await this.client.search({
      index: 'saa9vi_marketplace_sessions',
      from: skip,
      size: take,
      query: {
        function_score: {
          query: { bool: { must } },
          functions: [
            { field_value_factor: { field: 'bayesianRating', factor: 1.0, modifier: 'log1p' } },
            { filter: { term: { isSponsored: true } }, weight: 3.0 },
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

  private async searchInstructors(
    query: string,
    subjectTags?: string[],
    skip = 0,
    take = 20,
  ): Promise<{ hits: any[]; total: number }> {
    const must: any[] = [
      { multi_match: { query, fields: ['name^3', 'bio', 'academyName^2', 'subjectTags'] } },
    ];

    if (subjectTags && subjectTags.length > 0) {
      must.push({ terms: { subjectTags } });
    }

    const result = await this.client.search({
      index: 'saa9vi_marketplace_instructors',
      from: skip,
      size: take,
      query: { bool: { must } },
      sort: [{ _score: { order: 'desc' } }],
    });

    return {
      hits: result.hits.hits.map((h: any) => h._source),
      total: typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value ?? 0,
    };
  }
}
