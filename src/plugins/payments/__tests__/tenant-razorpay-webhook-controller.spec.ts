import 'reflect-metadata';
import * as crypto from 'crypto';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type {
  ChannelService,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from '@vendure/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantPaymentAccountService } from '../services/tenant-payment-account.service';
import type { TenantPaymentWebhookQueueService } from '../services/tenant-payment-webhook-queue.service';
import { TenantRazorpayWebhookController } from '../api/tenant-razorpay-webhook.controller';

const CHANNEL_ID = 'channel-tenant-11';
const CHANNEL_TOKEN = 'tenant-public-token-11';
const WEBHOOK_SECRET = 'tenant-webhook-secret';
const EVENT_ID = 'evt_tenant_001';

function signedRequest(payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return {
    rawBody,
    signature,
    req: { rawBody } as unknown as import('express').Request,
  };
}

describe('TenantRazorpayWebhookController (G-3 ingress)', () => {
  let controller: TenantRazorpayWebhookController;
  let eventRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
  };
  let channelService: Pick<ChannelService, 'getChannelFromToken'>;
  let requestContextService: Pick<RequestContextService, 'create'>;
  let connection: Pick<TransactionalConnection, 'getRepository'>;
  let accountService: Pick<TenantPaymentAccountService, 'getWebhookSecret'>;
  let webhookQueue: Pick<TenantPaymentWebhookQueueService, 'enqueueWebhookEvent'>;
  let order: string[];

  const channel = { id: CHANNEL_ID, token: CHANNEL_TOKEN } as any;
  const payload = {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_tenant_001',
          order_id: 'order_tenant_001',
          notes: { vendureOrderCode: 'ORDER-TENANT-001' },
        },
      },
    },
  };

  beforeEach(() => {
    order = [];
    eventRepo = {
      create: vi.fn((input) => input),
      save: vi.fn().mockImplementation(async (input) => {
        order.push('persist');
        return { ...input, id: 41 };
      }),
      findOne: vi.fn().mockResolvedValue(null),
    };
    channelService = {
      getChannelFromToken: vi.fn().mockResolvedValue(channel),
    };
    requestContextService = {
      create: vi.fn().mockResolvedValue({
        channelId: CHANNEL_ID,
        apiType: 'admin',
      } as RequestContext),
    };
    connection = {
      getRepository: vi.fn().mockReturnValue(eventRepo),
    } as unknown as Pick<TransactionalConnection, 'getRepository'>;
    accountService = {
      getWebhookSecret: vi.fn().mockResolvedValue(WEBHOOK_SECRET),
    } as unknown as Pick<TenantPaymentAccountService, 'getWebhookSecret'>;
    webhookQueue = {
      enqueueWebhookEvent: vi.fn().mockImplementation(async () => {
        order.push('enqueue');
      }),
    } as unknown as Pick<TenantPaymentWebhookQueueService, 'enqueueWebhookEvent'>;

    controller = new TenantRazorpayWebhookController(
      channelService as ChannelService,
      requestContextService as RequestContextService,
      connection as TransactionalConnection,
      accountService as TenantPaymentAccountService,
      webhookQueue as TenantPaymentWebhookQueueService,
    );
  });

  it('verifies raw bytes, persists the tenant-scoped receipt, then enqueues its ID', async () => {
    const signed = signedRequest(payload);

    const result = await controller.handleWebhook(
      CHANNEL_TOKEN,
      signed.signature,
      EVENT_ID,
      signed.req,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(channelService.getChannelFromToken).toHaveBeenCalledWith(CHANNEL_TOKEN);
    expect(accountService.getWebhookSecret).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL_ID }),
      CHANNEL_ID,
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: [channel],
        provider: 'razorpay',
        providerEventId: EVENT_ID,
        eventType: 'payment.captured',
        processingStatus: 'pending',
        vendureOrderCode: 'ORDER-TENANT-001',
      }),
    );
    expect(order).toEqual(['persist', 'enqueue']);
    expect(webhookQueue.enqueueWebhookEvent).toHaveBeenCalledWith(41);
  });

  it('rejects a tampered body or signature before writing any inbox row', async () => {
    const signed = signedRequest(payload);
    const tampered = Buffer.from(JSON.stringify({ ...payload, event: 'payment.failed' }));

    await expect(
      controller.handleWebhook(
        CHANNEL_TOKEN,
        signed.signature,
        EVENT_ID,
        { rawBody: tampered } as unknown as import('express').Request,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(eventRepo.save).not.toHaveBeenCalled();
    expect(webhookQueue.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing raw request body', async () => {
    await expect(
      controller.handleWebhook(
        CHANNEL_TOKEN,
        'signature',
        EVENT_ID,
        {} as import('express').Request,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('requires Razorpay event ID and event type after signature verification', async () => {
    const signed = signedRequest(payload);
    await expect(
      controller.handleWebhook(CHANNEL_TOKEN, signed.signature, '', signed.req),
    ).rejects.toBeInstanceOf(BadRequestException);

    const missingEvent = signedRequest({ entity: 'event' });
    await expect(
      controller.handleWebhook(CHANNEL_TOKEN, missingEvent.signature, EVENT_ID, missingEvent.req),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('re-enqueues a duplicate pending receipt after an earlier enqueue failure', async () => {
    const signed = signedRequest(payload);
    eventRepo.save.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_tenant_payment_webhook_event_dedupe',
    });
    eventRepo.findOne.mockResolvedValue({
      id: 77,
      processingStatus: 'pending',
      eventType: 'payment.captured',
      payloadHash: TenantRazorpayWebhookController.hashRawBody(signed.rawBody),
    });

    const result = await controller.handleWebhook(
      CHANNEL_TOKEN,
      signed.signature,
      EVENT_ID,
      signed.req,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(webhookQueue.enqueueWebhookEvent).toHaveBeenCalledWith(77);
  });

  it('rejects a duplicate Razorpay event ID when its payload hash changes', async () => {
    const signed = signedRequest(payload);
    eventRepo.save.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_tenant_payment_webhook_event_dedupe',
    });
    eventRepo.findOne.mockResolvedValue({
      id: 77,
      processingStatus: 'processed',
      eventType: 'payment.captured',
      payloadHash: 'f'.repeat(64),
    });

    await expect(
      controller.handleWebhook(CHANNEL_TOKEN, signed.signature, EVENT_ID, signed.req),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(webhookQueue.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it('does not treat unrelated database failures as duplicate deliveries', async () => {
    const signed = signedRequest(payload);
    eventRepo.save.mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.handleWebhook(CHANNEL_TOKEN, signed.signature, EVENT_ID, signed.req),
    ).rejects.toThrow('database unavailable');

    expect(eventRepo.findOne).not.toHaveBeenCalled();
    expect(webhookQueue.enqueueWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns non-2xx when durable persistence succeeds but queueing fails', async () => {
    const signed = signedRequest(payload);
    vi.mocked(webhookQueue.enqueueWebhookEvent).mockRejectedValue(
      new Error('queue unavailable'),
    );

    await expect(
      controller.handleWebhook(CHANNEL_TOKEN, signed.signature, EVENT_ID, signed.req),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(eventRepo.save).toHaveBeenCalledOnce();
  });

  it('fails closed when the channel has no configured webhook secret', async () => {
    const signed = signedRequest(payload);
    vi.mocked(accountService.getWebhookSecret).mockRejectedValue(
      new Error('Tenant Razorpay webhook secret is not configured'),
    );

    await expect(
      controller.handleWebhook(CHANNEL_TOKEN, signed.signature, EVENT_ID, signed.req),
    ).rejects.toThrow('Tenant Razorpay webhook secret is not configured');

    expect(eventRepo.save).not.toHaveBeenCalled();
  });
});
