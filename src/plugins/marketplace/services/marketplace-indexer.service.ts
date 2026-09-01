import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Channel, TransactionalConnection } from '@vendure/core';
import { BbbScheduledSession } from '../../bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { BbbOrganization } from '../../bigbluebutton-plugin/entities/bbb-organization.entity';
import { TenantProfile } from '../../tenant-plugin/entities/tenant-profile.entity';
import { InstructorProfile } from '../../tenant-plugin/entities/instructor-profile.entity';
import { MarketplaceAdService } from './marketplace-ad.service';
import { BayesianRatingService } from './bayesian-rating.service';

export interface MarketplaceSessionDocument {
  id: string;
  productVariantId: string | null;
  channelToken: string;
  channelId: string;
  title: string;
  startTime: string;
  endTime: string;
  priceInPaise: number;
  academyName: string;
  academySlug: string;
  customDomain: string | null;
  instructorName: string | null;
  subjectTags: string[];
  bayesianRating: number;
  isSponsored: boolean;
  sponsorBoost: number;
}

export interface MarketplaceInstructorDocument {
  id: string;
  channelId: string;
  channelToken: string;
  name: string;
  bio: string;
  slug: string;
  photoUrl: string | null;
  subjectTags: string[];
  reviewRating: number | null;
  academyName: string;
  academySlug: string;
  customDomain: string | null;
}

@Injectable()
export class MarketplaceIndexerService {
  private readonly logger = new Logger(MarketplaceIndexerService.name);
  private readonly client: Client;
  private readonly sessionsIndex = 'saa9vi_marketplace_sessions';
  private readonly instructorsIndex = 'saa9vi_marketplace_instructors';

  constructor(
    private readonly connection: TransactionalConnection,
    private readonly adService: MarketplaceAdService,
    private readonly bayesianService: BayesianRatingService,
  ) {
    const node = process.env.ELASTICSEARCH_NODE || process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
    const password = process.env.ELASTICSEARCH_PASSWORD;
    this.client = new Client({
      node,
      ...(password ? { auth: { username: 'elastic', password } } : {}),
    });
  }

  async ensureIndicesExist(): Promise<void> {
    await this.ensureSessionsIndex();
    await this.ensureInstructorsIndex();
  }

  private async ensureSessionsIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.sessionsIndex });
    if (!exists) {
      await this.client.indices.create({
        index: this.sessionsIndex,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            productVariantId: { type: 'keyword' },
            channelToken: { type: 'keyword' },
            channelId: { type: 'keyword' },
            title: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            startTime: { type: 'date' },
            endTime: { type: 'date' },
            priceInPaise: { type: 'integer' },
            academyName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            academySlug: { type: 'keyword' },
            customDomain: { type: 'keyword' },
            instructorName: { type: 'text' },
            subjectTags: { type: 'keyword' },
            bayesianRating: { type: 'float' },
            isSponsored: { type: 'boolean' },
            sponsorBoost: { type: 'float' },
          },
        },
      });
      this.logger.log(`Created Elasticsearch index: ${this.sessionsIndex}`);
    }
  }

  private async ensureInstructorsIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.instructorsIndex });
    if (!exists) {
      await this.client.indices.create({
        index: this.instructorsIndex,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            channelId: { type: 'keyword' },
            channelToken: { type: 'keyword' },
            name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            bio: { type: 'text' },
            slug: { type: 'keyword' },
            photoUrl: { type: 'keyword' },
            subjectTags: { type: 'keyword' },
            reviewRating: { type: 'float' },
            academyName: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            academySlug: { type: 'keyword' },
            customDomain: { type: 'keyword' },
          },
        },
      });
      this.logger.log(`Created Elasticsearch index: ${this.instructorsIndex}`);
    }
  }

  // ─── Session Indexing ──────────────────────────────────────────────────────

  async indexSession(sessionId: string): Promise<void> {
    const session = await this.connection.rawConnection
      .getRepository(BbbScheduledSession)
      .findOne({
        where: { id: sessionId },
        relations: ['organization', 'trainer'],
      });

    if (!session) {
      this.logger.warn(`Cannot index session ${sessionId}: not found`);
      return;
    }

    // ─── F7 (Gate 1.2): only publicly visible, live-cycle sessions belong in
    // the marketplace index. FINISHED/CANCELLED/PRIVATE sessions are removed
    // from the index if previously published. ────────────────────────────────
    const publiclyVisible =
      session.visibility === 'PUBLIC' &&
      (session.status === 'SCHEDULED' || session.status === 'LIVE');
    if (!publiclyVisible) {
      await this.deleteSession(String(session.id));
      return;
    }

    const tenantProfile = await this.connection.rawConnection
      .getRepository(TenantProfile)
      .findOne({ where: { channelId: session.channelId ?? undefined } });

    // ─── BUG-023: Resolve Channel.token and BbbOrganization.slug ────────────
    // channelToken must be the Channel.token (used in the vendure-token header),
    // not the raw channelId. academySlug comes from BbbOrganization.slug.
    let channelToken = session.channelId ?? '';
    let academySlug = '';
    if (session.channelId) {
      const channel = await this.connection.rawConnection
        .getRepository(Channel)
        .findOne({ where: { id: session.channelId as any } });
      if (channel) channelToken = channel.token;
      const org = await this.connection.rawConnection
        .getRepository(BbbOrganization)
        .findOne({ where: { channelId: session.channelId } });
      if (org) academySlug = org.slug;
    }

    // ─── Gap 3: Price from ProductVariant.price ─────────────────────────────
    let priceInPaise = 0;
    if (session.productVariantId) {
      try {
        const { ProductVariant } = require('@vendure/core');
        const variant = await this.connection.rawConnection
          .getRepository(ProductVariant)
          .findOne({ where: { id: session.productVariantId as any } });
        if (variant) {
          priceInPaise = (variant as any).price ?? 0;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to fetch ProductVariant price for ${session.productVariantId}: ${err.message}`);
      }
    }

    // ─── Gap 2: Bayesian rating from ReviewsPlugin aggregate ────────────────
    let bayesianRating = 0;
    if (session.productVariantId) {
      try {
        bayesianRating = await this.bayesianService.computeForVariant(session.productVariantId);
      } catch (err: any) {
        this.logger.warn(`Failed to compute Bayesian rating for variant ${session.productVariantId}: ${err.message}`);
      }
    }

    // ─── Gap 1: Sponsored listing bid-boost from MarketplaceAdCampaign ──────
    let isSponsored = false;
    let sponsorBoost = 1.0;
    try {
      const campaign = await this.adService.findActiveCampaignForSession(String(session.id));
      if (campaign) {
        isSponsored = true;
        sponsorBoost = campaign.boostWeight;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to check ad campaign for session ${session.id}: ${err.message}`);
    }

    const doc: MarketplaceSessionDocument = {
      id: String(session.id),
      productVariantId: session.productVariantId,
      channelToken,
      channelId: session.channelId ?? '',
      title: session.title,
      startTime: session.startTime.toISOString(),
      endTime: session.endTime.toISOString(),
      priceInPaise,
      academyName: tenantProfile?.businessName ?? '',
      academySlug,
      customDomain: tenantProfile?.customDomain ?? null,
      instructorName: session.trainer ? String(session.trainer.id) : null,
      subjectTags: session.subjectTags ?? [],
      bayesianRating,
      isSponsored,
      sponsorBoost,
    };

    await this.client.index({
      index: this.sessionsIndex,
      id: doc.id,
      document: doc,
    });
    this.logger.log(`Indexed marketplace session: ${doc.id} (price=${priceInPaise}, rating=${bayesianRating}, sponsored=${isSponsored})`);
  }

  async deleteSession(id: string): Promise<void> {
    try {
      await this.client.delete({ index: this.sessionsIndex, id });
    } catch (err: any) {
      if (err.statusCode !== 404) throw err;
    }
  }

  // ─── Instructor Indexing ───────────────────────────────────────────────────

  async indexInstructor(profileId: string): Promise<void> {
    const profile = await this.connection.rawConnection
      .getRepository(InstructorProfile)
      .findOne({ where: { id: profileId } });

    if (!profile) {
      this.logger.warn(`Cannot index instructor ${profileId}: not found`);
      return;
    }

    const tenantProfile = await this.connection.rawConnection
      .getRepository(TenantProfile)
      .findOne({ where: { channelId: profile.channelId } });

    // ─── BUG-023: Resolve Channel.token and BbbOrganization.slug ────────────
    let channelToken = profile.channelId;
    let academySlug = '';
    const channel = await this.connection.rawConnection
      .getRepository(Channel)
      .findOne({ where: { id: profile.channelId as any } });
    if (channel) channelToken = channel.token;
    const org = await this.connection.rawConnection
      .getRepository(BbbOrganization)
      .findOne({ where: { channelId: profile.channelId } });
    if (org) academySlug = org.slug;

    const doc: MarketplaceInstructorDocument = {
      id: String(profile.id),
      channelId: profile.channelId,
      channelToken,
      name: profile.fullName,
      bio: profile.bio || '',
      slug: profile.slug,
      photoUrl: profile.photoAssetId ? String(profile.photoAssetId) : null,
      subjectTags: profile.expertiseAreas || [],
      reviewRating: null,
      academyName: tenantProfile?.businessName ?? '',
      academySlug,
      customDomain: tenantProfile?.customDomain ?? null,
    };

    await this.client.index({
      index: this.instructorsIndex,
      id: doc.id,
      document: doc,
    });
    this.logger.log(`Indexed marketplace instructor: ${doc.id}`);
  }

  async deleteInstructor(id: string): Promise<void> {
    try {
      await this.client.delete({ index: this.instructorsIndex, id });
    } catch (err: any) {
      if (err.statusCode !== 404) throw err;
    }
  }

  // ─── Full Reindex ──────────────────────────────────────────────────────────

  async fullReindex(): Promise<void> {
    await this.ensureIndicesExist();

    // Reindex all sessions with productVariantId
    const sessions = await this.connection.rawConnection
      .getRepository(BbbScheduledSession)
      .find({ where: { productVariantId: { $ne: null } as any } });

    for (const session of sessions) {
      await this.indexSession(String(session.id));
    }
    this.logger.log(`Full reindex: ${sessions.length} sessions indexed`);

    // Reindex all public instructors
    const instructors = await this.connection.rawConnection
      .getRepository(InstructorProfile)
      .find({ where: { isPublic: true } });

    for (const instructor of instructors) {
      await this.indexInstructor(String(instructor.id));
    }
    this.logger.log(`Full reindex: ${instructors.length} instructors indexed`);
  }
}
