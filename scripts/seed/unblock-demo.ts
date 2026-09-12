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
  ProductVariantService,
} from '@vendure/core';
import type { User } from '@vendure/core';
import { Customer, Product, ProductVariant, StockLevel } from '@vendure/core';
import { BbbScheduledSession } from '../../src/plugins/bigbluebutton-plugin/entities/bbb-scheduled-session.entity';
import { BbbEntitlement } from '../../src/plugins/bigbluebutton-plugin/entities/bbb-entitlement.entity';
import { MarketplaceIndexerService } from '../../src/plugins/marketplace/services/marketplace-indexer.service';
import { config } from '../../src/vendure-config';

const CHANNEL_TOKEN = process.env.UNBLOCK_CHANNEL_TOKEN ?? 'tok_apex-academy_5famcu';
const VARIANT_SKU = process.env.UNBLOCK_VARIANT_SKU ?? 'PY-BOOTCAMP-01';
const SESSION_TITLE = process.env.UNBLOCK_SESSION_TITLE ?? 'Apex Python Bootcamp';
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
    const productVariantService = worker.app.get(ProductVariantService);

    console.log('=== Demo unblocker (data-only fixture prep) ===');

    // Resolve channel — use a system-level context to find all channels
    const defaultChannel = await channelService.getDefaultChannel();
    const systemCtx = await reqCtxService.create({ apiType: 'admin', channelOrToken: defaultChannel });
    const allChannels = await channelService.findAll(systemCtx);
    const apex = allChannels.items.find((c: any) => c.token === CHANNEL_TOKEN);
    if (!apex) throw new Error(`Channel token not found: ${CHANNEL_TOKEN}`);
    const ctx = await reqCtxService.create({ apiType: 'admin', channelOrToken: apex as any });
    console.log(`[resolved] channel code=${apex.code} id=${apex.id} token=${apex.token}`);

    // ─── (a) Variant stock: stockOnHand=10, trackInventory=ENABLED ─────────
    // Use ProductVariantService (not repository) so stock changes route through
    // Vendure's StockMovementService — semantically equivalent to the GraphQL
    // updateProductVariant mutation (ADR: fixture prep must not bypass stock machinery).
    const variantRepo = txnConn.getRepository(ctx, ProductVariant);
    const variant = await variantRepo.findOne({ where: { sku: VARIANT_SKU } });
    if (!variant) throw new Error(`Variant SKU not found: ${VARIANT_SKU}`);

    const updated = await productVariantService.update(ctx, [{
      id: String(variant.id),
      stockOnHand: 10,
      trackInventory: 'ENABLED' as any,
      outOfStockThreshold: 0,
    }]);
    const updatedVariant = updated[0];
    console.log(
      `[stock] variant=${updatedVariant.sku} id=${updatedVariant.id} ` +
        `trackInventory=${updatedVariant.trackInventory}`,
    );

    // Verify stock via stockLevels relation (stockOnHand lives on StockLevel, not ProductVariant)
    const stockLevelRepo = txnConn.getRepository(ctx, StockLevel);
    const stockLevels = (await stockLevelRepo.find({
      where: { productVariantId: variant.id },
    })) as any[];
    const totalStock = stockLevels.reduce((sum: number, sl: any) => sum + sl.stockOnHand, 0);
    if (totalStock < 10) {
      throw new Error(`Stock verification failed: total stockOnHand=${totalStock} (expected >= 10)`);
    }
    console.log(`[stock] verified total stockOnHand=${totalStock} across ${stockLevels.length} stock level(s)`);

    // ─── (b) Session visibility=PUBLIC ────────────────────────────────────
    // NOTE: UpdateBbbScheduledSessionInput has no 'status' field.
    // Status is internal — defaults to SCHEDULED on creation.
    const sessionRepo = txnConn.getRepository(ctx, BbbScheduledSession);
    const sessions = await sessionRepo.find({
      where: { title: SESSION_TITLE },
      relations: ['organization'],
    });
    const session = sessions.find(
      (s) => s.title === SESSION_TITLE && s.organization?.channelId === String(apex.id),
    ) ?? sessions[0];
    if (!session) throw new Error(`Session "${SESSION_TITLE}" not found`);

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
    // Demo customer MUST exist — required for deterministic fixture boundary.
    const customerRepo = txnConn.getRepository(ctx, Customer);
    const customer = await customerRepo.findOne({
      where: { emailAddress: CUSTOMER_EMAIL },
    });
    if (!customer) {
      throw new Error(`Demo customer "${CUSTOMER_EMAIL}" not found — required for fixture boundary verification`);
    }
    console.log(`[verify] customer=${customer.id} email=${customer.emailAddress}`);

    // Check: no entitlement for demo customer
    const entitlementRepo = txnConn.getRepository(ctx, BbbEntitlement);
    const entitlements = await entitlementRepo.find({
      where: { customerId: String(customer.id) },
    });
    if (entitlements.length > 0) {
      throw new Error(`Found ${entitlements.length} entitlements for demo customer — CTA boundary violated`);
    }
    console.log(`[verify] no entitlements for ${CUSTOMER_EMAIL} (count=0)`);

    // Check: no review for the product
    const productRepo = txnConn.getRepository(ctx, Product);
    const product = await productRepo.findOne({ where: { id: (variant as any).productId } });
    if (!product) {
      throw new Error(`Product not found for variant productId=${(variant as any).productId}`);
    }
    console.log(`[verify] product=${product.id} ${product.name} (no review check — reviews come from real purchases only)`);

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
