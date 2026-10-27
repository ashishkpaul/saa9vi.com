import { describe, expect, it, vi } from 'vitest';
import { TenantProfile } from '../entities/tenant-profile.entity';
import {
  TenantProfileUpdatedEvent,
  TenantRegisteredEvent,
} from '../events/tenant-events';
import { TenantProfileService } from '../services/tenant-profile.service';

function makeHarness(existingProfile: TenantProfile | null = null) {
  const profileRepo = {
    manager: { queryRunner: undefined },
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ('channelId' in where) return existingProfile;
      return null;
    }),
    save: vi.fn(async (entity: any) => {
      if (entity.id == null) entity.id = 'tenant-profile-1';
      return entity;
    }),
  };
  const slugRepo = {
    findOne: vi.fn().mockResolvedValue(null),
  };
  const channelRepo = {
    findOne: vi.fn().mockResolvedValue({ id: 'channel-1', token: 'channel-token-1' }),
  };
  const connection: any = {
    getRepository: vi.fn((_ctx: unknown, entity: unknown) =>
      entity === 'Channel' ? channelRepo : profileRepo,
    ),
    rawConnection: {
      getRepository: vi.fn(() => slugRepo),
    },
  };
  const channelService = {
    assignToChannels: vi.fn().mockResolvedValue(undefined),
  };
  const domainResolver = {
    setMapping: vi.fn().mockResolvedValue(undefined),
    removeMapping: vi.fn().mockResolvedValue(undefined),
  };
  const eventBus = {
    publish: vi.fn(),
  };
  const service = new TenantProfileService(
    connection,
    channelService as any,
    domainResolver as any,
    eventBus as any,
  );

  return {
    service,
    profileRepo,
    domainResolver,
    eventBus,
    channelService,
  };
}

describe('TenantProfileService — retired Saa9vi-hosted seller subdomains', () => {
  const ctx = { channelId: 'channel-1' } as any;

  it('creates the tenant profile and publishes the registration event without writing a platform-hostname mapping', async () => {
    const h = makeHarness();

    const profile = await h.service.create(ctx, {
      channelId: 'channel-1' as any,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.example',
      timezone: 'Asia/Kolkata',
    });

    expect(profile.tenantSlug).toBe('apex-academy');
    expect(h.domainResolver.setMapping).not.toHaveBeenCalled();
    expect(h.domainResolver.removeMapping).not.toHaveBeenCalled();
    expect(h.eventBus.publish).toHaveBeenCalledTimes(1);
    const event = h.eventBus.publish.mock.calls[0][0];
    expect(event).toBeInstanceOf(TenantRegisteredEvent);
    expect(event.tenantSlug).toBe('apex-academy');
    expect(event.channelId).toBe('channel-1');
    expect(h.channelService.assignToChannels).toHaveBeenCalledWith(
      ctx,
      TenantProfile,
      profile.id,
      ['channel-1'],
    );
  });

  it('continues to map an explicitly configured seller-owned custom domain', async () => {
    const h = makeHarness();

    await h.service.create(ctx, {
      channelId: 'channel-1' as any,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.example',
      timezone: 'Asia/Kolkata',
      customDomain: 'www.apexacademy.example',
    });

    expect(h.domainResolver.setMapping).toHaveBeenCalledTimes(1);
    expect(h.domainResolver.setMapping).toHaveBeenCalledWith(
      'www.apexacademy.example',
      'channel-token-1',
    );
  });

  it('updates custom-domain mappings without refreshing a generated Saa9vi seller-subdomain mapping', async () => {
    const existing = new TenantProfile({
      id: 'tenant-profile-1' as any,
      channelId: 'channel-1' as any,
      businessName: 'Apex Academy',
      tenantSlug: 'apex-academy',
      customDomain: 'old.apexacademy.example',
    });
    const h = makeHarness(existing);

    const updated = await h.service.update(ctx, 'channel-1' as any, {
      customDomain: 'www.apexacademy.example',
    });

    expect(updated.customDomain).toBe('www.apexacademy.example');
    expect(h.domainResolver.removeMapping).toHaveBeenCalledTimes(1);
    expect(h.domainResolver.removeMapping).toHaveBeenCalledWith(
      'old.apexacademy.example',
    );
    expect(h.domainResolver.setMapping).toHaveBeenCalledTimes(1);
    expect(h.domainResolver.setMapping).toHaveBeenCalledWith(
      'www.apexacademy.example',
      'channel-token-1',
    );
    expect(h.eventBus.publish.mock.calls[0][0]).toBeInstanceOf(
      TenantProfileUpdatedEvent,
    );
  });
});
