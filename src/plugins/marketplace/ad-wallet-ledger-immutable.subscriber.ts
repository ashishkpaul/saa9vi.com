import {
  EventSubscriber,
  EntitySubscriberInterface,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { AdWalletLedger } from './entities/ad-wallet-ledger.entity';

/**
 * Enforces the wallet-ledger financial invariant (ADR FEAT-003) at the service
 * boundary: `AdWalletLedger` rows are append-only. The entity definition alone
 * cannot guarantee immutability — this subscriber rejects any UPDATE or DELETE
 * against the ledger from any TypeORM code path (including raw repository
 * access). Wallet balance truth is SUM(amountInPaise) over these rows; a row
 * written in error must be reversed with a compensating row, never mutated.
 *
 * Inserts remain allowed (that is the "append" in append-only).
 */
@EventSubscriber()
export class AdWalletLedgerImmutableSubscriber implements EntitySubscriberInterface<AdWalletLedger> {
  listenTo() {
    return AdWalletLedger;
  }

  beforeUpdate(event: UpdateEvent<AdWalletLedger>): void {
    throw new Error(
      'Wallet-ledger invariant violation: AdWalletLedger rows are append-only and must never be updated. ' +
        `Refused UPDATE on ad_wallet_ledger id=${(event.entity as AdWalletLedger | undefined)?.id ?? 'unknown'}.`,
    );
  }

  beforeRemove(event: RemoveEvent<AdWalletLedger>): void {
    throw new Error(
      'Wallet-ledger invariant: AdWalletLedger rows are append-only and must never be deleted. ' +
        `Refused DELETE on ad_wallet_ledger id=${(event.entity as AdWalletLedger | undefined)?.id ?? 'unknown'}.`,
    );
  }
}