import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule } from '@vendure/core';
import { CorrelationInterceptor } from './correlation-interceptor';
import { BullMQTracer } from './bullmq-tracer';
import { WebhookRecorder } from './webhook-recorder';
import { EventLog } from './entities/event-log.entity';

/**
 * Platform-level tracing module.
 *
 * Registers the CorrelationInterceptor as a global APP_INTERCEPTOR so that
 * every incoming HTTP request — regardless of which plugin handles it —
 * gets a request-scoped correlation ID via AsyncLocalStorage.
 *
 * This module is imported by BigBlueButtonPlugin. Because APP_INTERCEPTOR
 * is a NestJS global provider, it applies to all modules in the application,
 * not just the importing module.
 *
 * Entities and services that are shared across plugins (EventLog, BullMQTracer,
 * WebhookRecorder) are also provided here so they can be injected by any plugin
 * without circular dependency concerns.
 */
@Global()
@Module({
  imports: [PluginCommonModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationInterceptor,
    },
    CorrelationInterceptor,
    BullMQTracer,
    WebhookRecorder,
  ],
  exports: [BullMQTracer, WebhookRecorder, CorrelationInterceptor],
})
export class PlatformTracingModule {}
