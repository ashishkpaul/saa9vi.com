import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IllegalOperationError } from '@vendure/core';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { TenantLearnerMembership } from '../entities/tenant-learner-membership.entity';
import { TenantLearnerMembershipLog } from '../entities/tenant-learner-membership-log.entity';
import type {
  TenantLearnerStatus,
  TenantLearnerAdmissionType,
} from '../entities/tenant-learner-membership.entity';

const loggerCtx = 'TenantLearnerMembershipService';

/**
 * Valid status transitions.
 * 'NEW' means no prior row exists.
 */
const ALLOWED_TRANSITIONS: Record<TenantLearnerStatus | 'NEW', TenantLearnerStatus[]> = {
  NEW:       ['PENDING'],
  PENDING:   ['ACTIVE', 'REVOKED'],
  ACTIVE:    ['SUSPENDED', 'REVOKED', 'LEFT'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED:   [],  // terminal — use readmit()
  LEFT:      [],  // terminal — use readmit()
};

function assertTransition(from: TenantLearnerStatus | null, to: TenantLearnerStatus): void {
  const key: TenantLearnerStatus | 'NEW' = from ?? 'NEW';
  const allowed = ALLOWED_TRANSITIONS[key] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalOperationError(
      `Invalid membership transition: ${from ?? 'NEW'} → ${to}`,
    );
  }
}

/**
 * Manages TenantLearnerMembership records — Saa9vi's tenant-specific
 * learner admission record.
 *
 * All status-changing operations append a TenantLearnerMembershipLog row so
 * every transition is permanently auditable. Direct row mutations from outside
 * this service break the audit trail and are not permitted.
 */
@Injectable()
export class TenantLearnerMembershipService {
  private readonly logger = new Logger(loggerCtx);

  constructor(private readonly connection: TransactionalConnection) {}

  // ── Read helpers ──────────────────────────────────────────────────────────

  async findOne(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<TenantLearnerMembership | null> {
    return this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .findOne({
        where: {
          customerId: String(customerId),
          channelId: String(channelId),
        },
      });
  }

  async findByCustomer(
    ctx: RequestContext,
    customerId: ID,
  ): Promise<TenantLearnerMembership[]> {
    return this.connection.getRepository(ctx, TenantLearnerMembership).find({
      where: { customerId: String(customerId) },
      order: { createdAt: 'DESC' },
    });
  }

  async findActiveByChannel(
    ctx: RequestContext,
    channelId: string,
  ): Promise<TenantLearnerMembership[]> {
    return this.connection.getRepository(ctx, TenantLearnerMembership).find({
      where: { channelId: String(channelId), status: 'ACTIVE' },
      order: { createdAt: 'DESC' },
    });
  }

  async findAllByChannel(
    ctx: RequestContext,
    channelId: string,
    options?: { skip?: number; take?: number },
  ): Promise<{ items: TenantLearnerMembership[]; totalItems: number }> {
    const [items, totalItems] = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .findAndCount({
        where: { channelId: String(channelId) },
        order: { createdAt: 'DESC' },
        skip: options?.skip ?? 0,
        take: options?.take ?? 50,
      });
    return { items, totalItems };
  }

  async findLogs(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<TenantLearnerMembershipLog[]> {
    return this.connection.getRepository(ctx, TenantLearnerMembershipLog).find({
      where: { customerId: String(customerId), channelId: String(channelId) },
      order: { transitionedAt: 'ASC' },
    });
  }

  async isActiveMember(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<boolean> {
    const membership = await this.findOne(ctx, customerId, channelId);
    return membership?.status === 'ACTIVE';
  }

  // ── Internal log writer ───────────────────────────────────────────────────

  private async writeLog(
    ctx: RequestContext,
    membership: TenantLearnerMembership,
    oldStatus: TenantLearnerStatus | null,
    newStatus: TenantLearnerStatus,
    reason: string | null,
    actorId: string | null,
  ): Promise<void> {
    const log = new TenantLearnerMembershipLog({
      membershipId: String(membership.id),
      customerId: membership.customerId,
      channelId: membership.channelId,
      oldStatus,
      newStatus,
      reason,
      actorId,
      transitionedAt: new Date(),
    });
    await this.connection.getRepository(ctx, TenantLearnerMembershipLog).save(log);
  }

  // ── Write operations ──────────────────────────────────────────────────────

  /**
   * Admit a new learner (creates PENDING row).
   *
   * Idempotent for PENDING/ACTIVE/SUSPENDED rows.
   * Throws for LEFT/REVOKED — use readmit() instead.
   */
  async admit(
    ctx: RequestContext,
    input: {
      customerId: ID;
      channelId: string;
      admissionType?: TenantLearnerAdmissionType;
      invitedByUserId?: ID | null;
      actorId?: string | null;
    },
  ): Promise<TenantLearnerMembership> {
    const existing = await this.findOne(ctx, input.customerId, input.channelId);

    if (existing) {
      if (existing.status === 'LEFT' || existing.status === 'REVOKED') {
        throw new IllegalOperationError(
          `Cannot admit customer=${input.customerId} to channel=${input.channelId}: ` +
          `existing membership is ${existing.status}. Use readmit() to re-open.`,
        );
      }
      this.logger.log(
        `Admit: membership already exists for customer=${input.customerId} ` +
        `channel=${input.channelId} status=${existing.status}`,
      );
      return existing;
    }

    const membership = new TenantLearnerMembership({
      customerId: String(input.customerId),
      channelId: String(input.channelId),
      status: 'PENDING',
      admissionType: input.admissionType ?? 'REGULAR',
      invitedByUserId: input.invitedByUserId ? String(input.invitedByUserId) : null,
      invitedAt: input.invitedByUserId ? new Date() : null,
      joinedAt: null,
      lastActivityAt: null,
    });

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(ctx, saved, null, 'PENDING', null, input.actorId ?? null);
    return saved;
  }

  /**
   * create() — backward-compatible wrapper around admit().
   * Supports an explicit status for seeding/fixture use; guards terminal rows.
   */
  async create(
    ctx: RequestContext,
    input: {
      customerId: ID;
      channelId: string;
      status?: TenantLearnerStatus;
      admissionType?: TenantLearnerAdmissionType;
      invitedByUserId?: ID | null;
    },
  ): Promise<TenantLearnerMembership> {
    const existing = await this.findOne(ctx, input.customerId, input.channelId);

    if (existing) {
      if (existing.status === 'LEFT' || existing.status === 'REVOKED') {
        throw new IllegalOperationError(
          `Cannot create membership for customer=${input.customerId} channel=${input.channelId}: ` +
          `existing row is ${existing.status}. Use readmit() to re-open.`,
        );
      }
      return existing;
    }

    const targetStatus = input.status ?? 'PENDING';
    const membership = new TenantLearnerMembership({
      customerId: String(input.customerId),
      channelId: String(input.channelId),
      status: targetStatus,
      admissionType: input.admissionType ?? 'REGULAR',
      invitedByUserId: input.invitedByUserId ? String(input.invitedByUserId) : null,
      invitedAt: input.invitedByUserId ? new Date() : null,
      joinedAt: targetStatus === 'ACTIVE' ? new Date() : null,
      lastActivityAt: null,
    });

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(ctx, saved, null, targetStatus, null, null);
    return saved;
  }

  /**
   * Transition a membership to ACTIVE.
   */
  async activate(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
    actorId?: string | null,
  ): Promise<TenantLearnerMembership> {
    const membership = await this.findOne(ctx, customerId, channelId);
    if (!membership) {
      throw new NotFoundException(
        `No membership found for customer=${customerId} channel=${channelId}`,
      );
    }

    assertTransition(membership.status, 'ACTIVE');
    const oldStatus = membership.status;
    membership.status = 'ACTIVE';
    membership.joinedAt = membership.joinedAt ?? new Date();
    membership.lastActivityAt = new Date();

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(ctx, saved, oldStatus, 'ACTIVE', null, actorId ?? null);
    return saved;
  }

  /**
   * Update lastActivityAt — does not log (not a status transition).
   */
  async updateActivity(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
  ): Promise<void> {
    const membership = await this.findOne(ctx, customerId, channelId);
    if (!membership || membership.status !== 'ACTIVE') return;
    membership.lastActivityAt = new Date();
    await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
  }

  /**
   * Suspend a learner. Reason is now persisted in the log.
   */
  async suspend(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
    reason?: string | null,
    actorId?: string | null,
  ): Promise<TenantLearnerMembership> {
    const membership = await this.findOne(ctx, customerId, channelId);
    if (!membership) {
      throw new NotFoundException(
        `No membership found for customer=${customerId} channel=${channelId}`,
      );
    }

    assertTransition(membership.status, 'SUSPENDED');
    const oldStatus = membership.status;
    membership.status = 'SUSPENDED';

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(ctx, saved, oldStatus, 'SUSPENDED', reason ?? null, actorId ?? null);
    return saved;
  }

  /**
   * Revoke a learner's membership — terminal state.
   * Idempotent: already-REVOKED rows are returned unchanged.
   */
  async revoke(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
    actorId?: string | null,
    reason?: string | null,
  ): Promise<TenantLearnerMembership> {
    const membership = await this.findOne(ctx, customerId, channelId);
    if (!membership) {
      throw new NotFoundException(
        `No membership found for customer=${customerId} channel=${channelId}`,
      );
    }

    if (membership.status === 'REVOKED') {
      return membership; // idempotent
    }

    const oldStatus = membership.status;
    membership.status = 'REVOKED';

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(ctx, saved, oldStatus, 'REVOKED', reason ?? null, actorId ?? null);
    return saved;
  }

  /**
   * Mark as LEFT — used by leaveAcademy (Shop API) and deletion handler.
   * Idempotent: already-terminal rows are returned unchanged.
   */
  async leaveAcademy(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
    actorId?: string | null,
  ): Promise<TenantLearnerMembership | null> {
    const membership = await this.findOne(ctx, customerId, channelId);
    if (!membership) return null;

    if (membership.status === 'LEFT' || membership.status === 'REVOKED') {
      return membership; // idempotent
    }

    const oldStatus = membership.status;
    membership.status = 'LEFT';

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(ctx, saved, oldStatus, 'LEFT', null, actorId ?? null);
    return saved;
  }

  /**
   * Re-admit a learner whose membership is LEFT or REVOKED.
   * Sets status back to PENDING and logs the re-admission.
   */
  async readmit(
    ctx: RequestContext,
    customerId: ID,
    channelId: string,
    actorId?: string | null,
    reason?: string | null,
  ): Promise<TenantLearnerMembership> {
    const membership = await this.findOne(ctx, customerId, channelId);
    if (!membership) {
      throw new NotFoundException(
        `No membership found for customer=${customerId} channel=${channelId}`,
      );
    }

    if (membership.status !== 'LEFT' && membership.status !== 'REVOKED') {
      throw new IllegalOperationError(
        `readmit() requires LEFT or REVOKED status; current status is ${membership.status}`,
      );
    }

    const oldStatus = membership.status;
    membership.status = 'PENDING';
    membership.joinedAt = null;
    membership.lastActivityAt = null;

    const saved = await this.connection
      .getRepository(ctx, TenantLearnerMembership)
      .save(membership);
    await this.writeLog(
      ctx, saved, oldStatus, 'PENDING',
      reason ?? 're-admitted', actorId ?? null,
    );
    return saved;
  }
}
