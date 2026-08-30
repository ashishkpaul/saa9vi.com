import { Module } from '@nestjs/common';
import { PluginCommonModule } from '@vendure/core';
import { PaymentObservabilityService } from './service/payment-observability.service';
import { CheckoutLockService } from './service/checkout-lock.service';
import Redis from 'ioredis';

@Module({
  imports: [PluginCommonModule],
  providers: [
    PaymentObservabilityService,
    CheckoutLockService,
    {
      provide: 'REDIS',
      useFactory: () => {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const redisPassword = process.env.REDIS_PASSWORD;

        const redis = new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword,
          maxRetriesPerRequest: 3,
          lazyConnect: true
        });

        redis.on('error', (err) => {
          console.error('Redis connection error:', err);
        });

        return redis;
      }
    }
  ],
  exports: [PaymentObservabilityService, CheckoutLockService]
})
export class PaymentsCoreModule {}
