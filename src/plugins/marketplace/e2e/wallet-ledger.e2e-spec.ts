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

      // 1. INSERT succeeds
      const row = await repo.save(
        repo.create({
          walletId: '1',
          type: 'topup',
          amountInPaise: 500000,
          occurredAt: new Date(),
          reference: 'smoke-topup-1',
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
            walletId: '1',
            type: 'topup',
            amountInPaise: 1,
            occurredAt: new Date(),
            reference: 'smoke-topup-1',
          }),
        ),
      ).rejects.toThrow();

      // 5. NULL references are exempt from uniqueness
      const n1 = await repo.save(
        repo.create({ walletId: '1', type: 'spend', amountInPaise: -100, occurredAt: new Date() }),
      );
      const n2 = await repo.save(
        repo.create({ walletId: '1', type: 'spend', amountInPaise: -200, occurredAt: new Date() }),
      );
      expect(n1.reference).toBeNull();
      expect(n2.reference).toBeNull();
    });
  });
});
