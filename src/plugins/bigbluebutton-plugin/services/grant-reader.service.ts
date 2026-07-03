import { Injectable, Logger } from "@nestjs/common";
import { TransactionalConnection } from "@vendure/core";
import { BbbCapacityGrant } from "../entities/bbb-capacity-grant.entity";

const loggerCtx = "GrantReaderService";

export interface CapacityGrantLike {
  id: string;
  grantedMinutes: number;
  consumedMinutes: number;
  validFrom: Date;
  validUntil: Date;
  exhausted: boolean;
  isUnbounded: boolean;
  sourceType: "order" | "subscription" | "internal_overhead";
}

/**
 * RFC-001 Q-009: Abstracted grant resolution seam.
 *
 * Phase 1 grants are BbbCapacityGrant rows (order / internal_overhead).
 * Phase 2 will add RecurringCapacityGrant (subscription) — adding it
 * requires only one new branch in resolveGrantForMeeting().
 *
 * This service exists so that BbbReconciliationService.consumeGrantHours()
 * does not directly query BbbCapacityGrant, closing the Q-009 seam.
 */
@Injectable()
export class GrantReaderService {
  constructor(
    private readonly connection: TransactionalConnection,
  ) {}

  private get repo() {
    return this.connection.rawConnection.getRepository(BbbCapacityGrant);
  }

  /**
   * Resolve a grant by ID and source type.
   * Phase 1: order and internal_overhead grants come from BbbCapacityGrant.
   * Phase 2: subscription grants will come from RecurringCapacityGrant.
   */
  async resolveGrantForMeeting(
    grantId: string,
    sourceType: "order" | "subscription" | "internal_overhead",
  ): Promise<CapacityGrantLike | null> {
    if (sourceType === "order" || sourceType === "internal_overhead") {
      const grant = await this.repo.findOneBy({ id: grantId });
      return grant ? this.toLike(grant) : null;
    }
    // Phase 2: query RecurringCapacityGrant table
    Logger.warn(
      `RecurringCapacityGrant not yet implemented — Phase 2 (grantId=${grantId})`,
      loggerCtx,
    );
    return null;
  }

  /**
   * Resolve the raw BbbCapacityGrant entity for transactional use.
   * Needed by BbbReconciliationService.consumeGrantHours() for TypeORM
   * relations in the billing transaction.
   */
  async resolveEntityForMeeting(
    grantId: string,
  ): Promise<BbbCapacityGrant | null> {
    return this.repo.findOne({
      where: { id: grantId },
      relations: ['organization'],
    });
  }

  /**
   * Find the earliest-expiring valid grant for an organization.
   */
  async findEarliestValidGrant(
    organizationId: string,
    _sourceTypes: Array<"order" | "subscription" | "internal_overhead">,
  ): Promise<CapacityGrantLike | null> {
    const grant = await this.repo.findOne({
      where: { organization: { id: organizationId }, exhausted: false },
      order: { validUntil: "ASC" },
    });
    return grant ? this.toLike(grant) : null;
  }

  /**
   * Phase 2 integration point for CapacityIntelligenceService
   * (RFC-001 Appendix C-5).
   */
  async getRemainingMinutes(organizationId: string): Promise<number> {
    const grants = await this.repo.find({
      where: { organization: { id: organizationId }, exhausted: false },
    });
    return grants.reduce(
      (sum: number, g: BbbCapacityGrant) =>
        sum +
        (g.isUnbounded ? Infinity : g.grantedMinutes - g.consumedMinutes),
      0,
    );
  }

  private toLike(grant: BbbCapacityGrant): CapacityGrantLike {
    return {
      id: String(grant.id),
      grantedMinutes: grant.grantedMinutes,
      consumedMinutes: grant.consumedMinutes,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
      exhausted: grant.exhausted,
      isUnbounded: grant.isUnbounded,
      sourceType: grant.sourceType,
    };
  }
}