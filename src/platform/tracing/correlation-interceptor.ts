import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CorrelationContext } from './correlation-context';

/**
 * NestJS interceptor that creates a request-scoped CorrelationContext
 * using AsyncLocalStorage. Each incoming HTTP request gets its own
 * isolated correlation ID namespace, eliminating the thread-safety
 * issue with static properties.
 *
 * The correlation ID is propagated via `x-correlation-id` header for
 * downstream service calls.
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const existingCorrelationId = request.headers['x-correlation-id'];

    return CorrelationContext.run(() => {
      // If no correlation ID provided, generate one
      const correlationId = existingCorrelationId || CorrelationContext.generateId();
      CorrelationContext.set(correlationId);

      // Attach to request for downstream access
      request['correlationId'] = correlationId;

      return next.handle().pipe(
        tap({
          next: () => {
            // Ensure cleanup after response is sent
            CorrelationContext.reset();
          },
          error: () => {
            // Ensure cleanup even on error
            CorrelationContext.reset();
          },
        }),
      );
    });
  }
}
