import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule } from '@vendure/core';
import { CorrelationInterceptor } from './correlation-interceptor';

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
 * Actual wiring (2026-10-20, execution-plan Phase 3): the previously
 * provided-but-never-called BullMQTracer and WebhookRecorder scaffolding was
 * deleted (no call sites existed). The durable EventLog entity remains
 * registered by BigBlueButtonPlugin (table kept pending a separate decision —
 * it currently has no live writers). CorrelationInterceptor is the only
 * active component in this module.
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
  ],
  exports: [CorrelationInterceptor],
})
export class PlatformTracingModule {}
