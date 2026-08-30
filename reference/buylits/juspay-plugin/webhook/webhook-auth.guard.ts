import * as NestCommon from '@nestjs/common';
import { JUSPAY_PLUGIN_OPTIONS } from '../constants';
import type { JuspayPluginOptions } from '../options';
import * as crypto from 'crypto';

@NestCommon.Injectable()
export class JuspayWebhookAuthGuard implements NestCommon.CanActivate {
  constructor(
    @NestCommon.Inject(JUSPAY_PLUGIN_OPTIONS) private readonly opts: JuspayPluginOptions
  ) {}

  canActivate(context: NestCommon.ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return this.verifyBasicAuth(request) && this.verifyHmac(request);
  }

  canActivateFromRequest(req: any): boolean {
    return this.verifyBasicAuth(req) && this.verifyHmac(req);
  }

  private verifyBasicAuth(req: any): boolean {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      return false;
    }

    const expected = 'Basic ' + Buffer.from(
      `${this.opts.webhookUsername}:${this.opts.webhookPassword}`
    ).toString('base64');

    // Guard: if lengths differ → return false immediately
    if (authHeader.length !== expected.length) {
      return false;
    }

    // Use timingSafeEqual to prevent timing oracle vulnerability
    return crypto.timingSafeEqual(
      Buffer.from(authHeader),
      Buffer.from(expected)
    );
  }

  private verifyHmac(req: any): boolean {
    // If webhookHmacSecret is not set → return true (feature disabled)
    if (!this.opts.webhookHmacSecret) {
      return true;
    }

    const signature = req.headers?.['x-jp-signature'];
    const rawBody = (req as any).rawBody as Buffer;

    // If either missing → return false
    if (!signature || !rawBody) {
      return false;
    }

    // Compute HMAC-SHA256 of rawBody using webhookHmacSecret
    const computedHmac = crypto
      .createHmac('sha256', this.opts.webhookHmacSecret)
      .update(rawBody)
      .digest('hex');

    // Use timingSafeEqual on hex digest vs header value
    return crypto.timingSafeEqual(
      Buffer.from(computedHmac),
      Buffer.from(signature)
    );
  }
}