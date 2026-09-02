import { EventSubscriber, EntitySubscriberInterface, InsertEvent, LoadEvent, RemoveEvent, UpdateEvent } from 'typeorm';
import { AdSpendLedger } from './entities/ad-spend-ledger.entity';

/**
 * Enforces INV-010 at the service boundary: AdSpendLedger rows are
 * append-only. The entity definition alone cannot guarantee immutability —
 * this subscriber rejects any UPDATE or DELETE against the ledger, from any
 * code path, including raw repository access.
 *
 * Inserts remain allowed (that is the "append" in append-only).
 */
@EventSubscriber()
export class AdSpendLedgerImmutableSubscriber implements EntitySubscriberInterface<AdSpendLedger> {
  listenTo() {
    return AdSpendLedger;
  }

  beforeUpdate(event: UpdateEvent<AdSpendLedger>): void {
    throw new Error(
      'INV-010 violation: AdSpendLedger rows are append-only and must never be updated. ' +
        `Refused UPDATE on ad_spend_ledger id=${(event.entity as AdSpendLedger | undefined)?.id ?? 'unknown'}.`,
    );
  }

  beforeRemove(event: RemoveEvent<AdSpendLedger>): void {
    throw new Error(
      'INV-010 violation: AdSpendLedger rows are append-only and must never be deleted. ' +
        `Refused DELETE on ad_spend_ledger id=${(event.entity as AdSpendLedger | undefined)?.id ?? 'unknown'}.`,
    );
  }
}
