/**
 * AdWalletLedger e2e (Phase 3C.1 smoke).
 *
 * Infrastructure-gated: requires Postgres. No Elasticsearch or Redis needed.
 *
 * Run:  WALLET_E2E=true npx vitest run --config vitest.config.mts src/plugins/marketplace/e2e/wallet-ledger.e2e-spec.ts
 *
 * Coverage:
 *   1. INSERT succeeds (append allowed)
 *   2. UPDATE rejected  (append-only invariant at the TypeORM boundary)
 *   3. DELETE rejected
 *   4. UNIQUE(reference): duplicate idempotency key rejected at the DB
 *   5. NULL references exempt from uniqueness (multiple anonymous rows OK)
 *   6. 3C.2 service boundary: ensureWallet / getBalance (ledger authority) /
 *      credit / debit / insufficient_funds / duplicate reference idempotency /
 *      concurrent debit serialization / cache drift self-healing
 *
 * Isolation: dedicated Postgres schema (e2e_wallet_ledger) so dev/live ledgers
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSuperadminContext } from '@vendure/testing/lib/utils/get-superadmin-context';

import { TenantPlugin } from '../../tenant-plugin/tenant-plugin.plugin';
import { MarketplaceIndexerPlugin } from '../marketplace-indexer.plugin';
import { SchemaPostgresInitializer } from '../../tenant-plugin/e2e/schema-postgres-initializer';
import { AdWalletLedger } from '../entities/ad-wallet-ledger.entity';
import { AdWalletLedgerImmutableSubscriber } from '../ad-wallet-ledger-immutable.subscriber';
import { AdWalletService } from '../services/ad-wallet.service';
import { AdWallet } from '../entities/ad-wallet.entity';
import { MarketplaceAdCampaign } from '../entities/marketplace-ad-campaign.entity';
import { AdSpendLedger } from '../entities/ad-spend-ledger.entity';
import { MarketplaceAdService } from '../services/marketplace-ad.service';
import { TransactionalConnection } from '@vendure/core';

registerInitializer('postgres', new SchemaPostgresInitializer());

const WALLET_E2E = process.env.WALLET_E2E === 'true';

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
    apiOptions: { port: 3078 },
    dbConnectionOptions: {
      type: 'postgres',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5435),
      database: process.env.DB_NAME ?? 'vendure',
      username: process.env.DB_USERNAME ?? 'vendure_user',
      password: process.env.DB_PASSWORD ?? '',
      schema: 'e2e_wallet_ledger',
      synchronize: true,
      // Vendure registers TypeORM subscribers only from this array, so the
      // immutability test is meaningful only with the subscriber registered here.
      subscribers: [AdWalletLedgerImmutableSubscriber],
    },
    plugins: [TenantPlugin, MarketplaceIndexerPlugin],
  }),
);

describe('AdWalletLedger (3C.1)', () => {
  const d = WALLET_E2E ? describe : describe.skip;

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
  }, 60000);

  afterAll(async () => {
    await server.destroy();
  });

  d('append-only invariant', () => {
    it('inserts, rejects UPDATE/DELETE, enforces UNIQUE(reference), allows multiple NULL references', async () => {
      const ctx = await getSuperadminContext(server.app);
      const repo = server.app.get(TransactionalConnection).getRepository(ctx, AdWalletLedger);
      // Unique per run: the e2e schema persists rows across runs. Also keep
      // this walletId distinct from service-created wallets (their ids are
      // small integers) so the ledger-sum checks in the 3C.2 block are isolated.
      const smokeRef = `smoke-topup-${Date.now()}`;
      const smokeWalletId = `smoke-wallet-${Date.now()}`;

      // 1. INSERT succeeds
      const row = await repo.save(
        repo.create({
          walletId: smokeWalletId,
          type: 'topup',
          amountInPaise: 500000,
          occurredAt: new Date(),
          reference: smokeRef,
        }),
      );
      expect(row.id).toBeDefined();

      // 2. UPDATE must throw (append-only invariant)
      await expect(
        repo.update({ id: row.id }, { amountInPaise: 1 } as any),
      ).rejects.toThrow(/append-only/);

      // 3. DELETE must throw
      await expect(repo.delete({ id: row.id })).rejects.toThrow(/append-only/);

      // 4. UNIQUE(reference): duplicate idempotency key rejected at the DB
      await expect(
        repo.save(
          repo.create({
            walletId: smokeWalletId,
            type: 'topup',
            amountInPaise: 1,
            occurredAt: new Date(),
            reference: smokeRef,
          }),
        ),
      ).rejects.toThrow();

      // 5. NULL references are exempt from uniqueness
      const n1 = await repo.save(
        repo.create({ walletId: smokeWalletId, type: 'spend', amountInPaise: -100, occurredAt: new Date() }),
      );
      const n2 = await repo.save(
        repo.create({ walletId: smokeWalletId, type: 'spend', amountInPaise: -200, occurredAt: new Date() }),
      );
      expect(n1.reference).toBeNull();
      expect(n2.reference).toBeNull();
    });
  });

  d('wallet service boundary (3C.2)', () => {
    it('credits, debits, refuses overdrafts, dedupes references, and self-heals the cache', async () => {
      const ctx = await getSuperadminContext(server.app);
      const svc = server.app.get(AdWalletService);
      const walletRepo = server.app.get(TransactionalConnection).getRepository(ctx, AdWallet);
      // Unique per run: the e2e schema persists rows across runs.
      const channelId = `svc-${Date.now()}`;

      // ensureWallet creates the wallet lazily
      const wallet = await svc.ensureWallet(ctx, channelId);
      expect(wallet).toBeDefined();

      // getBalance starts at 0 (ledger authority, not the cache)
      await expect(svc.getBalance(ctx, channelId)).resolves.toBe(0);

      // credit topup
      await expect(
        svc.creditWallet(ctx, { channelId, amountInPaise: 100000, type: 'topup', reference: 'topup-A', orderId: 'jp-1' }),
      ).resolves.toBe('inserted');
      await expect(svc.getBalance(ctx, channelId)).resolves.toBe(100000);

      // duplicate topup reference is an idempotent no-op (no double credit)
      await expect(
        svc.creditWallet(ctx, { channelId, amountInPaise: 100000, type: 'topup', reference: 'topup-A' }),
      ).resolves.toBe('duplicate_ref');
      await expect(svc.getBalance(ctx, channelId)).resolves.toBe(100000);

      // debit within balance
      await expect(
        svc.debitWallet(ctx, { channelId, amountInPaise: 30000, campaignId: 'c1', reference: 'spend-1' }),
      ).resolves.toBe('inserted');
      await expect(svc.getBalance(ctx, channelId)).resolves.toBe(70000);

      // duplicate debit reference is an idempotent no-op (no double spend)
      await expect(
        svc.debitWallet(ctx, { channelId, amountInPaise: 30000, campaignId: 'c1', reference: 'spend-1' }),
      ).resolves.toBe('duplicate_ref');
      await expect(svc.getBalance(ctx, channelId)).resolves.toBe(70000);

      // overdraft refused
      await expect(
        svc.debitWallet(ctx, { channelId, amountInPaise: 999999, campaignId: 'c1' }),
      ).resolves.toBe('insufficient_funds');

      // invalid inputs rejected (async validation -> rejected promise)
      await expect(
        svc.creditWallet(ctx, { channelId, amountInPaise: -5, type: 'topup' }),
      ).rejects.toThrow(/positive integer/);
      await expect(
        svc.debitWallet(ctx, { channelId, amountInPaise: 1.5 }),
      ).rejects.toThrow(/positive integer/);

      // cache drift self-healing: poison the cache, then a mutation recomputes it from the ledger
      await walletRepo.update({ id: wallet.id as any }, { balanceInPaise: 123456 });
      await svc.creditWallet(ctx, { channelId, amountInPaise: 50000, type: 'topup', reference: 'topup-B' });
      const refreshed = await walletRepo.findOneOrFail({ where: { channelId } });
      expect(refreshed.balanceInPaise).toBe(120000); // 100000 - 30000 + 50000 (ledger truth, not 123456+50000)
    });

    it('serializes concurrent debits — no double spend beyond the ledger balance', async () => {
      const ctx = await getSuperadminContext(server.app);
      const svc = server.app.get(AdWalletService);
      // Unique per run: the e2e schema persists rows across runs.
      const channelId = `race-${Date.now()}`;

      // Fund 100000, then fire two concurrent debits of 80000 each.
      await svc.creditWallet(ctx, { channelId, amountInPaise: 200000, type: 'topup', reference: 'topup-C' });
      await svc.debitWallet(ctx, { channelId, amountInPaise: 100000, campaignId: 'c1', reference: 'spend-pre' });

      const results = await Promise.all([
        svc.debitWallet(ctx, { channelId, amountInPaise: 80000, campaignId: 'c1', reference: 'spend-race-1' }),
        svc.debitWallet(ctx, { channelId, amountInPaise: 80000, campaignId: 'c1', reference: 'spend-race-2' }),
      ]);

      const wins = results.filter((r) => r === 'inserted').length;
      // Balance is 100000; both 80000 debits CANNOT both succeed.
      expect(wins).toBeLessThanOrEqual(1);
      // Ledger is authoritative and consistent either way.
      await expect(svc.getBalance(ctx, channelId)).resolves.toBe(100000 - wins * 80000);
    });
  });

  d('campaign spend boundary (3C.3)', () => {
    it('connects both ledgers atomically across the acceptance matrix', async () => {
      const ctx = await getSuperadminContext(server.app);
      const adSvc = server.app.get(MarketplaceAdService);
      const walletSvc = server.app.get(AdWalletService);
      const conn = server.app.get(TransactionalConnection);
      const run = Date.now();
      // The campaign must belong to the REQUESTING channel (ownership check).
      // Use ctx.channelId — the wallet for it persists across runs, so assert
      // on DELTAS from the pre-test balance rather than absolute values.
      const channelId = String(ctx.channelId);

      // Fund the wallet generously and create an eligible campaign.
      await walletSvc.creditWallet(ctx, { channelId, amountInPaise: 200000, type: 'topup', reference: `fund-${run}` });
      const balanceBefore = await walletSvc.getBalance(ctx, channelId);
      expect(balanceBefore).toBeGreaterThanOrEqual(200000);
      const campaignRepo = conn.getRepository(ctx, MarketplaceAdCampaign);
      const campaign = await campaignRepo.save(
        campaignRepo.create({
          channelId,
          type: 'sponsored_listing',
          status: 'active',
          budgetInPaise: 150000,
          startsAt: new Date(Date.now() - 60000),
          endsAt: new Date(Date.now() + 3600000),
        }),
      );
      const spendRepo = conn.getRepository(ctx, AdSpendLedger);
      const countSpend = () => spendRepo.count({ where: { campaignId: String(campaign.id) } });

      // 1. Valid spend: wallet debit + AdSpendLedger row, ledgers agree.
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'click',
          amountInPaise: 20000,
          reference: `sp-${run}-1`,
        }),
      ).resolves.toBe('recorded');
      await expect(countSpend()).resolves.toBe(1);
      await expect(walletSvc.getBalance(ctx, channelId)).resolves.toBe(balanceBefore - 20000);

      // 2. Duplicate reference across BOTH ledgers: no second debit, no second fact.
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'click',
          amountInPaise: 20000,
          reference: `sp-${run}-1`,
        }),
      ).resolves.toBe('duplicate_ref');
      await expect(countSpend()).resolves.toBe(1);
      await expect(walletSvc.getBalance(ctx, channelId)).resolves.toBe(balanceBefore - 20000);

      // 3. Insufficient wallet: no spend row, no debit. (Raise the budget cap
      // first so the budget check passes and the WALLET check is what refuses.)
      await campaignRepo.update({ id: campaign.id as any }, { budgetInPaise: 10000000 });
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'impression',
          amountInPaise: 999999,
          reference: `sp-${run}-2`,
        }),
      ).resolves.toBe('insufficient_funds');
      await expect(countSpend()).resolves.toBe(1);
      await expect(walletSvc.getBalance(ctx, channelId)).resolves.toBe(balanceBefore - 20000);

      // 4. Ineligible campaign (paused): neither ledger changes.
      await campaignRepo.update({ id: campaign.id as any }, { status: 'paused', budgetInPaise: 150000 });
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'impression',
          amountInPaise: 10000,
          reference: `sp-${run}-3`,
        }),
      ).resolves.toBe('campaign_invalid');
      await expect(countSpend()).resolves.toBe(1);
      await campaignRepo.update({ id: campaign.id as any }, { status: 'active' });

      // 5. Cross-channel spend: campaign's channel ≠ requesting channel.
      const foreign = await campaignRepo.save(
        campaignRepo.create({
          channelId: `other-${run}`,
          status: 'active',
          startsAt: new Date(Date.now() - 60000),
          endsAt: new Date(Date.now() + 3600000),
        }),
      );
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(foreign.id),
          eventType: 'impression',
          amountInPaise: 10000,
          reference: `sp-${run}-4`,
        }),
      ).resolves.toBe('campaign_invalid');
      await expect(countSpend()).resolves.toBe(1);

      // 6. Budget exceeded: true spent + requested > budget (INV-010 truth).
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'impression',
          amountInPaise: 200000, // spent 20000 + 200000 > budget 150000
          reference: `sp-${run}-5`,
        }),
      ).resolves.toBe('budget_exceeded');
      await expect(countSpend()).resolves.toBe(1);

      // 7. Invalid amount rejected.
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'click',
          amountInPaise: 0,
          reference: `sp-${run}-6`,
        }),
      ).rejects.toThrow(/positive integer/);
      await expect(countSpend()).resolves.toBe(1);

      // 8. Cache-poisoning: spend decisions follow the LEDGER, not the cache.
      const walletRow = await conn.getRepository(ctx, AdWallet).findOneOrFail({ where: { channelId } });
      await conn.getRepository(ctx, AdWallet).update({ id: walletRow.id as any }, { balanceInPaise: 1 });
      await expect(
        adSvc.recordCampaignSpend(ctx, {
          campaignId: String(campaign.id),
          eventType: 'click',
          amountInPaise: 30000,
          reference: `sp-${run}-7`,
        }),
      ).resolves.toBe('recorded'); // ledger says 80000 — enough, despite poisoned cache
      await expect(countSpend()).resolves.toBe(2);
      // Authoritative invariant: getBalance == SUM(AdWalletLedger); cache healed.
      await expect(walletSvc.getBalance(ctx, channelId)).resolves.toBe(balanceBefore - 50000);
      const walletHealed = await conn.getRepository(ctx, AdWallet).findOneOrFail({ where: { channelId } });
      expect(walletHealed.balanceInPaise).toBe(balanceBefore - 50000);
    });

    it('rolls back the wallet debit when the spend phase fails (atomicity primitive)', async () => {
      // recordCampaignSpend keeps the debit and the AdSpendLedger insert on ONE
      // transaction via debitWalletInTxn(). This test proves the underlying
      // rollback primitive deterministically: a debit that is followed by a
      // thrown error inside the same transaction leaves NO wallet-debit row.
      const ctx = await getSuperadminContext(server.app);
      const walletSvc = server.app.get(AdWalletService);
      const conn = server.app.get(TransactionalConnection);
      const run = Date.now();
      const channelId = `atomic-${run}`;

      await walletSvc.creditWallet(ctx, { channelId, amountInPaise: 100000, type: 'topup', reference: `fund-${run}` });
      await expect(walletSvc.getBalance(ctx, channelId)).resolves.toBe(100000);

      await expect(
        conn.withTransaction(ctx, async (txnCtx) => {
          const debit = await walletSvc.debitWalletInTxn(txnCtx, {
            channelId,
            amountInPaise: 30000,
            campaignId: 'c-atomic',
            reference: `atomic-${run}`,
          });
          expect(debit).toBe('inserted');
          // Simulated AdSpendLedger insert failure AFTER a successful debit:
          throw new Error('simulated AdSpendLedger failure');
        }),
      ).rejects.toThrow('simulated AdSpendLedger failure');

      // The debit rolled back with the transaction: no wallet movement, no
      // spend fact — the failure mode 'wallet debited, spend fact missing'
      // cannot occur.
      await expect(walletSvc.getBalance(ctx, channelId)).resolves.toBe(100000);
      const debitRows = await conn
        .getRepository(ctx, AdWalletLedger)
        .count({ where: { reference: `atomic-${run}` } });
      expect(debitRows).toBe(0);
    });
  });
});
