import { describe, expect, it, vi } from "vitest";
import {
  TENANT_SELF_SERVE_PLAN_CHANGE_COOLDOWN_SECONDS,
  TenantSelfServeSubscriptionCooldownService,
} from "../services/tenant-self-serve-subscription-cooldown.service";

describe("TenantSelfServeSubscriptionCooldownService", () => {
  it("uses an atomic five-minute SET NX EX keyed by channel", async () => {
    const service = new TenantSelfServeSubscriptionCooldownService();
    const set = vi.fn().mockResolvedValue("OK");
    (service as any).redis = { set };

    await service.acquire("15");

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      "subscription:self-serve:plan-change:15",
      "1",
      "EX",
      TENANT_SELF_SERVE_PLAN_CHANGE_COOLDOWN_SECONDS,
      "NX",
    );
  });

  it("rejects when NX is not acquired", async () => {
    const service = new TenantSelfServeSubscriptionCooldownService();
    const set = vi.fn().mockResolvedValue(null);
    (service as any).redis = { set };

    await expect(service.acquire("15")).rejects.toThrow(
      /already requested for this tenant/i,
    );
  });

  it("fails closed when Redis is unavailable", async () => {
    const service = new TenantSelfServeSubscriptionCooldownService();
    (service as any).redis = null;

    await expect(service.acquire("15")).rejects.toThrow(
      /cooldown protection is unavailable/i,
    );
  });

  it("rejects a missing channel id without touching Redis", async () => {
    const service = new TenantSelfServeSubscriptionCooldownService();
    const set = vi.fn();
    (service as any).redis = { set };

    await expect(service.acquire("")).rejects.toThrow(/Tenant channel is required/i);
    expect(set).not.toHaveBeenCalled();
  });
});
