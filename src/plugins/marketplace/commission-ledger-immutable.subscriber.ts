import {
  EventSubscriber,
  EntitySubscriberInterface,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { CommissionLedger } from './entities/commission-ledger.entity';

/**
 * Enforces INV-002 / DL-030 at the service boundary: `CommissionLedger` rows
 * are append-only. The entity definition alone cannot guarantee immutability — this
 * subscriber rejects any UPDATE or DELETE against the ledger from any TypeORM code
 * path (including raw repository access via TypeORM). Direct raw SQL against the
 * connection would bypass ORM lifecycle hooks; no Saa9vi service uses raw SQL on this
 * table, so the subscriber is the authoritative DB-service boundary backstop.

 * Inserts remain allowed (that is the "append" in append-only).
 */
@EventSubscriber()
export class CommissionLedgerImmutableSubscriber implements EntitySubscriberInterface<CommissionLedger> {
  listenTo() {
    return CommissionLedger;
  }

  beforeUpdate(event: UpdateEvent<CommissionLedger>): void {
    throw new Error(
      'INV-002/DL-030 violation: CommissionLedger rows are append-only and must never be updated. ' +
        `Refused UPDATE on commission_ledger id=${(event.entity as CommissionLedger | undefined)?.id ?? 'unknown'}.`,
    );
  }

  beforeRemove(event: RemoveEvent<CommissionLedger>): void {
    throw new Error(
      'INV-002/DL-030 violation: CommissionLedger rows are append-only and must never be deleted. ' +
        `Refused DELETE on commission_ledger id=${(event.entity as CommissionLedger | undefined)?.id ?? 'unknown'}.`,
    );
  }
}