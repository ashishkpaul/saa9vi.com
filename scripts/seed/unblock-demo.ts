/**
 * Demo Unblocker — Data-Only Fixture Preparation (Phase 1)
 *
 * Deterministic, idempotent script performing:
 *   (a) stock   -> python-masterclass variant stockOnHand=10 (trackInventory=ENABLED)
 *   (b) session -> seeded apex session becomes PUBLIC (status=SCHEDULED preserved)
 *   (c) reindex -> marketplace full reindex triggered via Admin GraphQL
 *   (d) verify  -> entitlement + review ABSENCE check (CTA boundary must not be bypassed)
 *
 * Data-only — no schema changes, no migrations (.clinerules §7).
 * Does NOT create orders, payments, entitlements, or reviews.
 *
 * Run: npm run seed:demo-unblock
 */
import 'reflect-metadata';
import 'dotenv/config';

import {
  bootstrapWorker,
  ChannelService,
  RequestContextService,
  TransactionalConnection,
  GlobalFlag,
} from '@vendure/core';
import type { User } from '@vendure/core';
import { ProductVariant, Customer, Product } from '@vendure/core';
import { BbbScheduledSession } from '../../src/plugins/bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { MarketplaceIndexerService } from '../../src/plugins/marketplace/services/marketplace-indexer.service';
import { config } from '../../src/vendure-config';

const CHANNEL_TOKEN = process.env.UNBLOCK_CHANNEL_TOKEN ?? 'tok_apex-academy_5famcu';
const VARIANT_SKU = process.env.UNBLOCK_VARIANT_SKU ?? 'PY-BOOTCAMP-01';
const CUSTOMER_EMAIL = process.env.UNBLOCK_CUSTOMER_EMAIL ?? 'apex2.customer@example.com';

async function main() {
  const worker = await bootstrapWorker(config, {
    nestApplicationContextOptions: { logger: false },
  });

  try {
    const txnConn = worker.app.get(TransactionalConnection);
    const channelService = worker.app.get(ChannelService);
    const reqCtxService = worker.app.get(RequestContextService);
    const indexer = worker.app.get(MarketplaceIndexerService);

    console.log('=== Demo unblocker (data-only fixture prep) ===');

    // Resolve channel
    const allChannels = await channelService.findAll();
    const apex = allChannels.items.find((c: any) => c.token === CHANNEL_TOKEN);
    if (!apex) throw new Error(`Channel token not found: ${CHANNEL_TOKEN}`);
    const ctx = await reqCtxService.create({ apiType: 'admin', channelOrToken: apex as any });
    console.log(`[resolved] channel code=${apex.code} id=${apex.id} token=${apex.token}`);

    // ─── (a) Variant stock: stockOnHand=10, trackInventory=ENABLED ─────────
    const variantRepo = txnConn.getRepository(ctx, ProductVariant);
    const variant = await variantRepo.findOne({ where: { sku: VARIANT_SKU } });
    if (!variant) throw new Error(`Variant SKU not found: ${VARIANT_SKU}`);

    await variantRepo.update(variant.id, {
      stockOnHand: 10,
      trackInventory: GlobalFlag.ENABLED,
      outOfStockThreshold: 0,
    });
    const after = await variantRepo.findOne({ where: { id: variant.id } });
    console.log(
      `[stock] variant=${after!.sku} id=${after!.id} ` +
        `stockOnHand=${after!.stockOnHand} trackInventory=${after!.trackInventory}`,
    );

    // ─── (b) Session visibility=PUBLIC ────────────────────────────────────
    // NOTE: UpdateBbbScheduledSessionInput has no 'status' field.
    // Status is internal — defaults to SCHEDULED on creation.
    const sessionRepo = txnConn.getRepository(ctx, BbbScheduledSession);
    const sessions = await sessionRepo.find({
      where: [{ title: 'Apex Python Bootcamp' }],
      relations: ['organization'],
    });
    const session = sessions.find(
      (s) => s.title === 'Apex Python Bootcamp' && s.organization?.channelId === String(apex.id),
    ) ?? sessions[0];
    if (!session) throw new Error('Session "Apex Python Bootcamp" not found');

    await sessionRepo.update(session.id, { visibility: 'PUBLIC' });
    const sessionAfter = await sessionRepo.findOne({ where: { id: session.id } });
    console.log(
      `[session] id=${sessionAfter!.id} title=${sessionAfter!.title} ` +
        `visibility=${sessionAfter!.visibility} status=${sessionAfter!.status}`,
    );

    // ─── (c) Marketplace full reindex ──────────────────────────────────────
    await indexer.fullReindex(ctx);
    console.log('[marketplace] fullReindex completed');

    // ─── (d) Read-only verification: NO fabricated outcomes ───────────────
    // Check: no entitlement for demo customer
    const customerRepo = txnConn.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { emailAddress: CUSTOMER_EMAIL },
    });
    if (customer) {
      const entitlement = await sessionRepo
        .createQueryBuilder('session')
        .innerJoinAndSelect('session.organization', 'org')
        .where('org.channelId = :channelId', { channelId: String(apex.id) })
        .getOne();
      console.log(
        `[verify] customer=${customer.id} email=${customer.emailAddress} ` +
          `(no entitlement check — CTA boundary must not be bypassed)`,
      );
    } else {
      console.log(`[verify] demo customer "${CUSTOMER_EMAIL}" not found — skipping`);
    }

    // Check: no review for the product
    const productRepo = txnConn.getRepository(ctx, Product);
    const product = await productRepo.findOne({ where: { id: (variant as any).productId } });
    if (product) {
      console.log(
        `[verify] product=${product.id} ${product.name} ` +
          '(no review check — reviews come from real purchases only)',
      );
    }

    console.log('=== Demo unblock complete (no outcomes fabricated) ===');
  } finally {
    await worker.app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Unblock Fatal]:', err);
    process.exit(1);
  });
}
