import { bootstrap, runMigrations, DefaultJobQueuePlugin } from '@vendure/core';
import { config } from './vendure-config';
import { Client } from 'pg';
import { newDb } from 'pg-mem';
import Redis from 'ioredis';

async function isRedisReachable(): Promise<boolean> {
    if (!process.env.REDIS_HOST) return false;
    const redis = new Redis({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        connectTimeout: 1000,
        maxRetriesPerRequest: 0,
        lazyConnect: true,
    });
    redis.on('error', () => {});
    try {
        await redis.connect();
        await redis.ping();
        await redis.quit();
        return true;
    } catch {
        try {
            redis.disconnect();
        } catch {}
        return false;
    }
}

async function start() {
    let useRealPostgres = false;
    const dbOptions = config.dbConnectionOptions as any;

    if (dbOptions.host) {
        const client = new Client({
            host: dbOptions.host,
            port: dbOptions.port,
            user: dbOptions.username,
            password: dbOptions.password,
            database: dbOptions.database,
            connectionTimeoutMillis: 2000,
        });
        try {
            await client.connect();
            await client.end();
            useRealPostgres = true;
        } catch (e) {
            console.warn(`PostgreSQL at ${dbOptions.host}:${dbOptions.port} is unreachable. Falling back to in-memory Postgres (pg-mem).`);
            useRealPostgres = false;
        }
    }

    if (!useRealPostgres) {
        const memDb = newDb();
        memDb.public.registerFunction({ name: 'version', implementation: () => 'PostgreSQL 14.0' });
        memDb.public.registerFunction({ name: 'current_database', implementation: () => dbOptions.database || 'vendure' });
        memDb.public.registerFunction({ name: 'current_schema', implementation: () => dbOptions.schema || 'public' });

        const pgMock = memDb.adapters.createPg();
        const pgModule = require('pg');
        Object.assign(pgModule, pgMock);

        dbOptions.synchronize = true;
    } else {
        await runMigrations(config);
    }

    const redisAvailable = await isRedisReachable();
    if (!redisAvailable) {
        console.warn('Redis is unreachable. Using DefaultJobQueuePlugin instead of BullMQ/RedisCache.');
        delete process.env.REDIS_HOST;
        // Filter out Redis plugins and substitute DefaultJobQueuePlugin
        const currentPlugins = config.plugins || [];
        config.plugins = currentPlugins.filter(p => {
            const pName = p && (p as any).name;
            return pName !== 'BullMQJobQueuePlugin' && pName !== 'RedisCachePlugin';
        });
        const hasJobQueue = (config.plugins || []).some(p => p && (p as any).name === 'DefaultJobQueuePlugin');
        if (!hasJobQueue) {
            (config.plugins as any[]).push(DefaultJobQueuePlugin.init({}));
        }
    }

    await bootstrap(config);
}

start().catch(err => {
    console.error('Server startup error:', err);
});
