/**
 * Regression tests for retiring Saa9vi-hosted seller subdomains.
 *
 * Verifies that TenantProfileService no longer creates or refreshes
 * {tenantSlug}.saa9vi.com hostname mappings, preserves custom-domain
 * mapping lifecycle, rejects Saa9vi platform hostnames as custom domains,
 * and still publishes TenantRegisteredEvent unconditionally so downstream
 * consumers (BigBlueButton, free-plan) continue to work.
 *
 * Pure unit tests — no server boot, no DB, no Redis. Dependencies are mocked.
 */
import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IllegalOperationError, RequestContext } from '@vendure/core';
import { TenantProfileService } from '../services/tenant-profile.service';
import { TenantProfile } from '../entities/tenant-profile.entity';
import { TenantRegisteredEvent } from '../events/tenant-events';

function makeService() {
  const domainResolver = {
    setMapping: vi.fn(),
    removeMapping: vi.fn(),
  } as any;
  const eventBus = {
    publish: vi.fn(),
  } as any;
  const channelService = {
    assignToChannels: vi.fn(async () => {}),
  } as any;

  const profileRepo = {
    findOne: vi.fn(),
    save: vi.fn(async (p: any) => p),
    manager: { queryRunner: null },
  };
  const channelRepo = {
    findOne: vi.fn(),
    manager: { queryRunner: null },
  };

  const connection = {
    getRepository: vi.fn((_ctx: unknown, entity: any) => {
      if (entity === TenantProfile) return profileRepo;
      return channelRepo;
    }),
    rawConnection: {
      getRepository: vi.fn(() => profileRepo),
    },
  } as any;

  const service = new TenantProfileService(
    connection,
    channelService,
    domainResolver,
    eventBus,
  );

  return {
    service,
    domainResolver,
    eventBus,
    channelService,
    connection,
    profileRepo,
    channelRepo,
  };
}

const ctx = {} as RequestContext;
const channelId = 'channel-1';
const channel = { id: channelId, token: 'tok_apex-academy_xyz' };

describe('TenantProfileService — no hosted seller subdomains', () => {
  let service: any;
  let domainResolver: any;
  let eventBus: any;
  let profileRepo: any;
  let channelRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const s = makeService();
    service = s.service;
    domainResolver = s.domainResolver;
    eventBus = s.eventBus;
    profileRepo = s.profileRepo;
    channelRepo = s.channelRepo;
    profileRepo.findOne.mockResolvedValue(null);
    channelRepo.findOne.mockResolvedValue(channel);
  });

  it('create() does NOT write a {tenantSlug}.saa9vi.com hostname mapping', async () => {
    await service.create(ctx, {
      channelId,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.in',
    });

    const setMappingCalls = domainResolver.setMapping.mock.calls as Array<[string, string]>;
    const hostedMapping = setMappingCalls.some(
      ([domain]) => typeof domain === 'string' && domain.endsWith('.saa9vi.com')
    );
    expect(hostedMapping).toBe(false);
    expect(setMappingCalls.length).toBe(0);
  });

  it('create() publishes TenantRegisteredEvent unconditionally (decoupled from hostname)', async () => {
    await service.create(ctx, {
      channelId,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.in',
    });

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const published = eventBus.publish.mock.calls[0][0];
    expect(published).toBeInstanceOf(TenantRegisteredEvent);
    expect((published as TenantRegisteredEvent).channelId).toBe(channelId);
    expect((published as TenantRegisteredEvent).tenantSlug).toBe('apex-academy');
    expect((published as TenantRegisteredEvent).businessName).toBe('Apex Academy');
  });

  it('create() with a valid custom domain writes the custom-domain mapping only', async () => {
    await service.create(ctx, {
      channelId,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.in',
      customDomain: 'www.apexacademy.in',
    });

    expect(domainResolver.setMapping).toHaveBeenCalledTimes(1);
    expect(domainResolver.setMapping).toHaveBeenCalledWith(
      'www.apexacademy.in',
      'tok_apex-academy_xyz',
    );
  });

  it('create() rejects customDomain equal to saa9vi.com', async () => {
    await expect(
      service.create(ctx, {
        channelId,
        businessName: 'Apex Academy',
        contactEmail: 'admin@apexacademy.in',
        customDomain: 'saa9vi.com',
      }),
    ).rejects.toThrow(IllegalOperationError);
  });

  it('create() rejects customDomain that is a Saa9vi subdomain', async () => {
    await expect(
      service.create(ctx, {
        channelId,
        businessName: 'Apex Academy',
        contactEmail: 'admin@apexacademy.in',
        customDomain: 'apex-academy.saa9vi.com',
      }),
    ).rejects.toThrow(IllegalOperationError);
  });

  it('create() rejects customDomain in URL form (https://www.saa9vi.com/)', async () => {
    await expect(
      service.create(ctx, {
        channelId,
        businessName: 'Apex Academy',
        contactEmail: 'admin@apexacademy.in',
        customDomain: 'https://www.saa9vi.com/',
      }),
    ).rejects.toThrow(IllegalOperationError);
  });

  it('update() changing customDomain removes old mapping and sets new mapping', async () => {
    const existingProfile = new TenantProfile({
      id: 'profile-1',
      channelId,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.in',
      customDomain: 'old.apexacademy.in',
    });
    profileRepo.findOne.mockResolvedValue(existingProfile);

    await service.update(ctx, channelId, { customDomain: 'new.apexacademy.in' });

    expect(domainResolver.removeMapping).toHaveBeenCalledWith('old.apexacademy.in');
    expect(domainResolver.setMapping).toHaveBeenCalledWith(
      'new.apexacademy.in',
      'tok_apex-academy_xyz',
    );
  });

  it('update() rejects new customDomain that is a Saa9vi platform hostname', async () => {
    const existingProfile = new TenantProfile({
      id: 'profile-1',
      channelId,
      businessName: 'Apex Academy',
      contactEmail: 'admin@apexacademy.in',
    });
    profileRepo.findOne.mockResolvedValue(existingProfile);

    await expect(
      service.update(ctx, channelId, { customDomain: 'apex-academy.saa9vi.com' }),
    ).rejects.toThrow(IllegalOperationError);
  });
});