import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { InstructorProfile } from '../entities/instructor-profile.entity';

interface InstructorDocument {
  id: string;
  channelId: string;
  channelToken: string;
  name: string;
  bio: string;
  slug: string;
  photoUrl: string | null;
  subjectTags: string[];
  reviewRating: number | null;
  isPublic: boolean;
}

@Injectable()
export class InstructorIndexerService implements OnModuleInit {
  private readonly logger = new Logger(InstructorIndexerService.name);
  private readonly client: Client;
  private readonly indexName = 'instructor_profiles';

  constructor() {
    const node = process.env.ELASTICSEARCH_NODE || process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
    const password = process.env.ELASTICSEARCH_PASSWORD;
    this.client = new Client({
      node,
      ...(password ? { auth: { username: 'elastic', password } } : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndexExists();
    } catch (err: any) {
      this.logger.warn(`Elasticsearch is not available: ${err.message}. Indexing will be skipped until ES is reachable.`);
    }
  }

  async ensureIndexExists(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.client.indices.create({
        index: this.indexName,
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
            isPublic: { type: 'boolean' },
          },
        },
      });
      this.logger.log(`Created Elasticsearch index: ${this.indexName}`);
    }
  }

  async indexProfile(profile: InstructorProfile): Promise<void> {
    const doc = this.mapDocument(profile);
    await this.client.index({
      index: this.indexName,
      id: doc.id,
      document: doc,
    });
    this.logger.log(`Indexed instructor profile: ${doc.id}`);
  }

  async deleteProfile(id: string): Promise<void> {
    try {
      await this.client.delete({
        index: this.indexName,
        id,
      });
    } catch (err: any) {
      if (err.statusCode !== 404) {
        throw err;
      }
    }
    this.logger.log(`Deleted instructor profile from index: ${id}`);
  }

  async fullReindex(profiles: InstructorProfile[]): Promise<void> {
    await this.ensureIndexExists();
    const bulkOps: any[] = [];
    for (const profile of profiles) {
      const doc = this.mapDocument(profile);
      if (doc.isPublic) {
        bulkOps.push(
          { index: { _index: this.indexName, _id: doc.id } },
          doc,
        );
      }
    }
    if (bulkOps.length === 0) {
      this.logger.log('No public profiles to index');
      return;
    }
    const body = bulkOps.flat();
    await this.client.bulk({ refresh: true, body });
    this.logger.log(`Full reindex completed for ${bulkOps.length / 2} documents`);
  }

  private mapDocument(profile: InstructorProfile): InstructorDocument {
    return {
      id: String(profile.id),
      channelId: String(profile.channelId),
      channelToken: '',
      name: profile.fullName,
      bio: profile.bio || '',
      slug: profile.slug,
      photoUrl: profile.photoAssetId ? String(profile.photoAssetId) : null,
      subjectTags: profile.expertiseAreas || [],
      reviewRating: null,
      isPublic: profile.isPublic,
    };
  }
}
