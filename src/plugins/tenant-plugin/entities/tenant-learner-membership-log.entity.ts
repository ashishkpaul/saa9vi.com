import type { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import type { TenantLearnerStatus } from './tenant-learner-membership.entity';

/**
 * Append-only audit log for TenantLearnerMembership status transitions.
 *
 * Every status-changing operation on TenantLearnerMembership must write a row
 * here. Rows are never updated or deleted — they form the permanent audit
 * trail for admission decisions.
 *
 * `actorId` is the User.id of the staff member or system performing the
 * transition; null means a system-initiated action (e.g. bulk delete).
 */
@Entity('tenant_learner_membership_log')
@Index(['membershipId'])
@Index(['customerId', 'channelId'])
export class TenantLearnerMembershipLog extends VendureEntity {
  constructor(input?: DeepPartial<TenantLearnerMembershipLog>) {
    super(input);
  }

  /** TenantLearnerMembership.id — the row being transitioned */
  @Column({ type: 'varchar' })
  membershipId: string;

  /** Denormalised for fast per-customer / per-channel log reads */
  @Column({ type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar' })
  channelId: string;

  /** Status before the transition; null on first admission (no previous row) */
  @Column({ type: 'varchar', nullable: true })
  oldStatus: TenantLearnerStatus | null;

  /** Status after the transition */
  @Column({ type: 'varchar' })
  newStatus: TenantLearnerStatus;

  /** Human-readable reason supplied by the actor */
  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  /** User.id of the staff member or system performing the transition */
  @Column({ type: 'varchar', nullable: true })
  actorId: string | null;

  /** When the transition occurred */
  @Column({ type: 'timestamp' })
  transitionedAt: Date;
}
