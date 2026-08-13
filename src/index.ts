import { bootstrap, runMigrations } from '@vendure/core';
import { config } from './vendure-config';
import { Client } from 'pg';
import { newDb } from 'pg-mem';

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

    await bootstrap(config);
}

start().catch(err => {
    console.error('Server startup error:', err);
});
