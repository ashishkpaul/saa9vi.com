import * as NestCommon from '@nestjs/common';
import { ForbiddenException, Logger } from '@nestjs/common';
import { JuspayWebhookAuthGuard } from './webhook-auth.guard';
import { JuspayWebhookQueue } from '../jobs/juspay-webhook.queue';
import type { JuspayWebhookEvent } from '../types';

@NestCommon.Controller('payments')
export class JuspayWebhookController {
  private readonly logger = new Logger(JuspayWebhookController.name);

  constructor(
    private readonly authGuard: JuspayWebhookAuthGuard,
    private readonly queue: JuspayWebhookQueue
  ) {}

  @NestCommon.Post('juspay')
  @NestCommon.HttpCode(NestCommon.HttpStatus.OK)
  async handleWebhook(
    @NestCommon.Req() req: any,
    @NestCommon.Body() event: JuspayWebhookEvent,
    @NestCommon.Headers('authorization') authHeader: string,
    @NestCommon.Headers('x-jp-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    // 1. Build requestWithExtras object merging req.headers, signature, rawBody
    const requestWithExtras = {
      headers: req.headers,
      rawBody: (req as any).rawBody
    };

    // 2. Call authGuard.canActivateFromRequest(requestWithExtras)
    const isValid = this.authGuard.canActivateFromRequest(requestWithExtras);

    // 3. If false:
    if (!isValid) {
      // - Log warn with event_name and order_id
      this.logger.warn(`Invalid webhook credentials for ${event.event_name} order: ${event.content.order.order_id}`);
      // - Throw ForbiddenException('Invalid webhook credentials')
      throw new ForbiddenException('Invalid webhook credentials');
    }

    // 4. Log info: 'Received: {event_name} order: {order_id}'
    this.logger.log(`Received: ${event.event_name} order: ${event.content.order.order_id}`);

    // 5. await queue.enqueue(event)
    await this.queue.enqueue(event);

    // 6. Return { received: true }
    return { received: true };
  }
}