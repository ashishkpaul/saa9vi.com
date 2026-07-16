import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type TenantRegistrationStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

/**
 * Append-only audit log for self-serve tenant/seller registration requests.
 *
 * Mirrors the BbbWebhookEvent (INV-004) / CustomerDeletionLog (INV-013)
 * persist-first pattern: the request is logged as PENDING before any
 * Seller / Channel / Role / Administrator entity is created, so a crash
 * partway through registerTenant() is auditable and recoverable rather than
 * silently losing the request or leaving an orphaned half-built tenant with
 * no record of what happened.
 */
@Entity('tenant_registration_log')
@Index(['emailAddress'])
@Index(['status'])
export class TenantRegistrationLog extends VendureEntity {
  constructor(input?: DeepPartial<TenantRegistrationLog>) {
    super(input);
  }

  @Column({ type: 'varchar' })
  businessName: string;

  /** The prospective tenant admin's email — also the future Administrator identifier */
  @Column({ type: 'varchar' })
  emailAddress: string;

  @Column({ type: 'timestamp with time zone' })
  requestedAt: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'varchar', default: 'PENDING' })
  status: TenantRegistrationStatus;

  /** Populated once the Channel is successfully created */
  @Column({ type: 'varchar', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar', nullable: true })
  channelToken: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;
}
