/**
 * Full advertising E2E (Phase 3C.6).
 *
 * Infrastructure-gated: requires Postgres. No Elasticsearch or Redis needed.
 *
 * Run:  ADVERTISING_E2E=true npx vitest run --config vitest.config.mts src/plugins/marketplace/e2e/advertising.e2e-spec.ts
 *
 * Coverage:
 *   1. Wallet credit (topup) → ledger row + balance
 *   2. Campaign creation → persisted with correct fields
 *   3. Valid campaign spend → wallet debit + AdSpendLedger row + cache refresh
 *   4. Insufficient wallet → no spend row, no debit
 *   5. Duplicate spend reference → no second debit, no second spend fact
 *   6. AdWalletLedger immutability (UPDATE/DELETE rejected)
 *   7. AdSpendLedger immutability (UPDATE/DELETE rejected, INV-010)
 *   8. Cross-channel spend → rejected (tenant isolation)
 *   9. Inactive campaign spend → rejected
 *  10. Budget exceeded → rejected
 *  11. Invalid amount (0/negative) → rejected
 *  12. Ledger authority: getBalance == SUM(AdWalletLedger), not cache
 *
 * Isolation: dedicated Postgres schema (e2e_advertising) so dev/live ledgers
 * are never touched.
 */

import 'reflect-metadata';
import 'dotenv/config';
import net from 'net';
import {
  createTestEnvironment,
  registerInitializer,
  testConfig,
} from '@vendure/testing';
import { mergeConfig } from '@vendure/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { CmsPlugin } from '../../cms/cms.plugin';
import { MarketplaceIndexerPlugin } from '../marketplace-indexer.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { AdWalletLedger } from '../entities/ad-wallet-ledger.entity';
import { AdWalletLedgerImmutableSubscriber } from '../ad-wallet-ledger-immutable.subscriber';
import { AdSpendLedgerImmutableSubscriber } from '../ad-spend-ledger-immutable.subscriber';
import { AdWalletService } from '../services/ad-wallet.service';
import { AdWallet } from '../entities/ad-wallet.entity';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import { MarketplaceAdService } from '../services/marketplace-ad.service';
import { TransactionalConnection } from '@vendure/core';

registerInitializer('postgres', new SchemaPostgresInitializer());

const ADVERTISING_E2E = process.env.ADVERTISING_E2E === 'true';

async function assertPostgres(): Promise<void> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 5435);
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(port, host);
    sock.once('connect', () => { sock.destroy(); resolve(); });
    sock.once('error', (err) => reject(err));
  });
}

const { server } = createTestEnvironment(
  mergeConfig(testConfig, {
    apiOptions: { port: 3079 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5435),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_advertising',
      synchronize: true,
      // Register BOTH immutability subscribers so the ledger tests are meaningful.
      subscribers: [AdWalletLedgerImmutableSubscriber, AdSpendLedgerImmutableSubscriber],
    },
    plugins: [TenantPlugin, CmsPlugin, MarketplaceIndexerPlugin],
  }),
);

describe('Advertising (3C.6)', () => {
  const d = ADVERTISING_E2E ? describe : describe.skip;

  let adWalletService: AdWalletService;
  let adService: MarketplaceAdService;
  let connection: TransactionalConnection;
  let defaultChannelId: string;

  beforeAll(async () => {
    await assertPostgres();
    await server.init({
      initialData: {
        defaultLanguage: 'en' as any,
        defaultZone: 'India',
        taxRates: [{ name: 'Standard Tax', percentage: 18 }],
        shippingMethods: [{ name: 'Standard Shipping', price: 0 }],
        paymentMethods: [],
        countries: [{ name: 'India', code: 'IN', zone: 'India' }],
        collections: [],
      },
      customerCount: 0,
    });
    adWalletService = server.app.get(AdWalletService);
    adService = server.app.get(MarketplaceAdService);
    connection = server.app.get(TransactionalConnection);
    const ctx = await getSuperadminContext(server.app);
    defaultChannelId = String(ctx.channelId);
  }, 60000);

  afterAll(async () => {
    await server.destroy();
  });

  // Reset the shared default-channel wallet between tests so balances are deterministic.
  beforeEach(async () => {
    const ctx = await getSuperadminContext(server.app);
    // clear() issues TRUNCATE; child tables first to satisfy FK constraints.
    await connection.getRepository(ctx, AdSpendLedger).clear();
    await connection.getRepository(ctx, AdWalletLedger).clear();
    await connection.getRepository(ctx, MarketplaceAdCampaign).clear();
    await connection.getRepository(ctx, AdWallet).clear();
  });

  // Helper: get a Superadmin ctx. Channel isolation is achieved by passing
  // a unique channelId to each service call (same pattern as wallet-ledger e2e).
  async function ctxForChannel(_channelId: string) {
    return getSuperadminContext(server.app);
  }

  // Helper: create a campaign directly in the DB on the ctx's channel
  async function createCampaign(
    channelId: string,
    overrides: Partial<MarketplaceAdCampaign> = {},
  ): Promise<MarketplaceAdCampaign> {
    const ctx = await ctxForChannel(channelId);
    const repo = connection.getRepository(ctx, MarketplaceAdCampaign);
    const now = new Date();
    return repo.save(
      repo.create({
        channelId,
        type: 'sponsored_listing',
        status: 'active',
        budgetInPaise: 1000000,
        spentInPaise: 0,
        targetSubject: null,
        targetCity: null,
        startsAt: new Date(now.getTime() - 86400000),
        endsAt: new Date(now.getTime() + 86400000),
        boostWeight: 3.0,
        ...overrides,
      }),
    );
  }

  d('wallet credit', () => {
    it('credits a wallet and reflects the balance from the ledger', async () => {
      const channelId = `credit-${Date.now()}`;
      const ctx = await ctxForChannel(channelId);

      // Credit via topup
      const result = await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 100000,
        type: 'topup',
        reference: `topup-${Date.now()}`,
      });
      expect(result).toBe('inserted');

      // Balance from ledger
      const balance = await adWalletService.getBalance(ctx, channelId);
      expect(balance).toBe(100000);

      // Ledger row exists
      const ledgerRepo = connection.getRepository(ctx, AdWalletLedger);
      const rows = await ledgerRepo.find({ where: { walletId: String((await adWalletService.ensureWallet(ctx, channelId)).id) } });
      expect(rows).toHaveLength(1);
      expect(rows[0].amountInPaise).toBe(100000);
      expect(rows[0].type).toBe('topup');
    });

    it('rejects duplicate credit reference (idempotent no-op)', async () => {
      const channelId = `credit-dup-${Date.now()}`;
      const ctx = await ctxForChannel(channelId);
      const ref = `topup-dup-${Date.now()}`;

      const first = await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 50000,
        type: 'topup',
        reference: ref,
      });
      expect(first).toBe('inserted');

      const second = await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 50000,
        type: 'topup',
        reference: ref,
      });
      expect(second).toBe('duplicate_ref');

      // Balance unchanged
      const balance = await adWalletService.getBalance(ctx, channelId);
      expect(balance).toBe(50000);
    });
  });

  d('campaign creation', () => {
    it('persists a campaign with correct fields', async () => {
      const channelId = defaultChannelId;
      const campaign = await createCampaign(channelId, {
        budgetInPaise: 500000,
        boostWeight: 2.5,
      });

      expect(campaign.id).toBeDefined();
      expect(campaign.channelId).toBe(channelId);
      expect(campaign.status).toBe('active');
      expect(campaign.budgetInPaise).toBe(500000);
      expect(campaign.boostWeight).toBe(2.5);
    });
  });

  d('valid campaign spend', () => {
    it('records spend: wallet debit + AdSpendLedger row + cache refresh', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      // Fund the wallet
      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 200000,
        type: 'topup',
        reference: `fund-${Date.now()}`,
      });

      // Create campaign
      const campaign = await createCampaign(channelId, { budgetInPaise: 1000000 });

      // Record spend
      const result = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'click',
        amountInPaise: 10000,
        reference: `spend-${Date.now()}`,
      });
      expect(result).toBe('recorded');

      // Wallet debited
      const balance = await adWalletService.getBalance(ctx, channelId);
      expect(balance).toBe(190000);

      // AdSpendLedger row exists
      const spendRepo = connection.getRepository(ctx, AdSpendLedger);
      const spendRows = await spendRepo.find({ where: { campaignId: campaign.id as any } });
      expect(spendRows).toHaveLength(1);
      expect(spendRows[0].amountInPaise).toBe(10000);
      expect(spendRows[0].eventType).toBe('click');

      // Cache refreshed (INV-010)
      const campaignRepo = connection.getRepository(ctx, MarketplaceAdCampaign);
      const refreshed = await campaignRepo.findOne({ where: { id: campaign.id as any } });
      expect(refreshed?.spentInPaise).toBe(10000);
    });

    it('derives balance from ledger, not cache', async () => {
      const channelId = `ledger-auth-${Date.now()}`;
      const ctx = await ctxForChannel(channelId);

      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 75000,
        type: 'topup',
        reference: `auth-${Date.now()}`,
      });

      // Poison the cache
      const wallet = await adWalletService.ensureWallet(ctx, channelId);
      const walletRepo = connection.getRepository(ctx, AdWallet);
      await walletRepo.update({ id: wallet.id }, { balanceInPaise: 1 });

      // getBalance must return ledger truth
      const balance = await adWalletService.getBalance(ctx, channelId);
      expect(balance).toBe(75000);
    });
  });

  d('insufficient wallet', () => {
    it('refuses spend when wallet balance is insufficient', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      // Small funding
      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 5000,
        type: 'topup',
        reference: `small-${Date.now()}`,
      });

      // Create campaign with budget larger than wallet → wallet check fires first
      const campaign = await createCampaign(channelId, { budgetInPaise: 1000000 });

      const result = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'click',
        amountInPaise: 10000,
        reference: `insufficient-${Date.now()}`,
      });
      expect(result).toBe('insufficient_funds');

      // No spend row
      const spendRepo = connection.getRepository(ctx, AdSpendLedger);
      const spendRows = await spendRepo.find({ where: { campaignId: campaign.id as any } });
      expect(spendRows).toHaveLength(0);

      // Wallet unchanged
      const balance = await adWalletService.getBalance(ctx, channelId);
      expect(balance).toBe(5000);
    });
  });

  d('duplicate spend reference', () => {
    it('rejects duplicate spend reference (idempotent across both ledgers)', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 200000,
        type: 'topup',
        reference: `fund-dup-${Date.now()}`,
      });

      const campaign = await createCampaign(channelId, { budgetInPaise: 1000000 });
      const ref = `dup-ref-${Date.now()}`;

      const first = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'impression',
        amountInPaise: 15000,
        reference: ref,
      });
      expect(first).toBe('recorded');

      const second = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'impression',
        amountInPaise: 15000,
        reference: ref,
      });
      expect(second).toBe('duplicate_ref');

      // Only one spend row
      const spendRepo = connection.getRepository(ctx, AdSpendLedger);
      const spendRows = await spendRepo.find({ where: { campaignId: campaign.id as any } });
      expect(spendRows).toHaveLength(1);

      // Wallet debited only once
      const balance = await adWalletService.getBalance(ctx, channelId);
      expect(balance).toBe(185000);
    });
  });

  d('ledger immutability', () => {
    it('rejects UPDATE/DELETE on AdWalletLedger (append-only)', async () => {
      const channelId = `ledger-immut-${Date.now()}`;
      const ctx = await ctxForChannel(channelId);

      const ledgerRepo = connection.getRepository(ctx, AdWalletLedger);
      const row = await ledgerRepo.save(
        ledgerRepo.create({
          walletId: `immut-wallet-${Date.now()}`,
          type: 'topup',
          amountInPaise: 50000,
          occurredAt: new Date(),
          reference: `immut-${Date.now()}`,
        }),
      );

      // UPDATE rejected
      await expect(
        ledgerRepo.update({ id: row.id }, { amountInPaise: 1 } as any),
      ).rejects.toThrow(/append-only/);

      // DELETE rejected
      await expect(ledgerRepo.delete({ id: row.id })).rejects.toThrow(/append-only/);
    });

    it('rejects UPDATE/DELETE on AdSpendLedger (INV-010)', async () => {
      const channelId = `spend-immut-${Date.now()}`;
      const ctx = await ctxForChannel(channelId);
      const campaign = await createCampaign(channelId, { budgetInPaise: 1000000 });
      const spendRepo = connection.getRepository(ctx, AdSpendLedger);
      const row = await spendRepo.save(
        spendRepo.create({
          campaignId: campaign.id as any,
          eventType: 'click',
          amountInPaise: 10000,
          occurredAt: new Date(),
        }),
      );

      // UPDATE rejected
      await expect(
        spendRepo.update({ id: row.id }, { amountInPaise: 1 } as any),
      ).rejects.toThrow(/INV-010/);

      // DELETE rejected
      await expect(spendRepo.delete({ id: row.id })).rejects.toThrow(/INV-010/);
    });
  });

  d('tenant isolation', () => {
    it('rejects cross-channel campaign spend', async () => {
      const channelA = `isolation-a-${Date.now()}`;
      const channelB = `isolation-b-${Date.now()}`;
      const ctxA = await ctxForChannel(channelA);
      const ctxB = await ctxForChannel(channelB);

      // Fund channel A
      await adWalletService.creditWallet(ctxA, {
        channelId: channelA,
        amountInPaise: 100000,
        type: 'topup',
        reference: `iso-fund-${Date.now()}`,
      });

      // Create campaign for channel A
      const campaign = await createCampaign(channelA, { budgetInPaise: 1000000 });

      // Channel B tries to spend from channel A's campaign
      const result = await adService.recordCampaignSpend(ctxB, {
        campaignId: String(campaign.id),
        eventType: 'click',
        amountInPaise: 10000,
        reference: `iso-spend-${Date.now()}`,
      });
      expect(result).toBe('campaign_invalid');

      // Channel A wallet unchanged
      const balance = await adWalletService.getBalance(ctxA, channelA);
      expect(balance).toBe(100000);
    });
  });

  d('campaign validation', () => {
    it('rejects spend on paused campaign', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 100000,
        type: 'topup',
        reference: `paused-fund-${Date.now()}`,
      });

      const campaign = await createCampaign(channelId, { status: 'paused' });

      const result = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'click',
        amountInPaise: 10000,
        reference: `paused-spend-${Date.now()}`,
      });
      expect(result).toBe('campaign_invalid');
    });

    it('rejects spend on expired campaign', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 100000,
        type: 'topup',
        reference: `exp-fund-${Date.now()}`,
      });

      const now = new Date();
      const campaign = await createCampaign(channelId, {
        startsAt: new Date(now.getTime() - 172800000),
        endsAt: new Date(now.getTime() - 86400000),
      });

      const result = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'click',
        amountInPaise: 10000,
        reference: `exp-spend-${Date.now()}`,
      });
      expect(result).toBe('campaign_invalid');
    });

    it('rejects spend exceeding budget', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      await adWalletService.creditWallet(ctx, {
        channelId,
        amountInPaise: 1000000,
        type: 'topup',
        reference: `budget-fund-${Date.now()}`,
      });

      const campaign = await createCampaign(channelId, { budgetInPaise: 50000 });

      const result = await adService.recordCampaignSpend(ctx, {
        campaignId: String(campaign.id),
        eventType: 'click',
        amountInPaise: 60000,
        reference: `budget-spend-${Date.now()}`,
      });
      expect(result).toBe('budget_exceeded');
    });

    it('rejects zero/negative/invalid amount', async () => {
      const channelId = defaultChannelId;
      const ctx = await ctxForChannel(channelId);

      const campaign = await createCampaign(channelId);

      await expect(
        adService.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'click',
          amountInPaise: 0,
          reference: `zero-${Date.now()}`,
        }),
      ).rejects.toThrow(/positive integer/);

      await expect(
        adService.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'click',
          amountInPaise: -100,
          reference: `neg-${Date.now()}`,
        }),
      ).rejects.toThrow(/positive integer/);
    });
  });
});



