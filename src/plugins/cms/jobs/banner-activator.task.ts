import { ScheduledTask, TransactionalConnection } from "@vendure/core";
import { Logger } from "@nestjs/common";
import { Banner } from "../entities/banner.entity";

const loggerCtx = "BannerActivatorTask";

/**
 * Runs every minute to precompute Banner.isCurrentlyActive based on
 * isActive flag + startsAt/endsAt date window.
 *
 * This replaces the runtime date filter in BannerService.findActiveForPlacement()
 * with a precomputed flag, eliminating the need for date-range comparisons
 * on every storefront page load (BUG-015 / CMS-002).
 *
 * Two queries:
 *   activator:   banners that should be active but aren't yet
 *   deactivator: banners that should no longer be active
 */
export const bannerActivatorTask = new ScheduledTask({
  id: "banner-activator",
  description: "Activate banners whose startsAt has arrived",
  schedule: (cron) => cron.every(1).minutes(),
  async execute({ injector }) {
    const connection = injector.get(TransactionalConnection);
    const now = new Date();

    // Activate: isActive=true, startsAt <= now, endsAt > now (or null), isCurrentlyActive=false
    const toActivate = await connection
      .getRepository(Banner)
      .createQueryBuilder("banner")
      .where("banner.isActive = true")
      .andWhere("banner.isCurrentlyActive = false")
      .andWhere("(banner.startsAt IS NULL OR banner.startsAt <= :now)", { now })
      .andWhere("(banner.endsAt IS NULL OR banner.endsAt >= :now)", { now })
      .getMany();

    if (toActivate.length > 0) {
      const ids = toActivate.map((b) => b.id as string);
      await connection.getRepository(Banner).update(ids, { isCurrentlyActive: true });
      Logger.log(`Activated ${toActivate.length} banner(s)`, loggerCtx);
    }

    // Deactivate: isCurrentlyActive=true AND (isActive=false OR endsAt < now)
    const toDeactivate = await connection
      .getRepository(Banner)
      .createQueryBuilder("banner")
      .where("banner.isCurrentlyActive = true")
      .andWhere(
        "(banner.isActive = false OR (banner.endsAt IS NOT NULL AND banner.endsAt < :now))",
        { now },
      )
      .getMany();

    if (toDeactivate.length > 0) {
      const ids = toDeactivate.map((b) => b.id as string);
      await connection.getRepository(Banner).update(ids, { isCurrentlyActive: false });
      Logger.log(`Deactivated ${toDeactivate.length} banner(s)`, loggerCtx);
    }

    return { activated: toActivate.length, deactivated: toDeactivate.length };
  },
});
