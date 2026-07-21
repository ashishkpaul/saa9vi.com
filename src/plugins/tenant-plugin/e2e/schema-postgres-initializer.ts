import path from 'path';
import { Client } from 'pg';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { TestDbInitializer } from '@vendure/testing/lib/initializers/test-db-initializer';

/**
 * A Postgres initializer that uses schema-based isolation instead of creating
 * a new database.
 *
 * The default `PostgresInitializer` from `@vendure/testing` requires the
 * `CREATEDB` privilege because it creates a new database per test file.
 * This initializer instead creates an isolated **schema** within the existing
 * database, which only requires `CREATE` privilege on the database (which
 * the database owner has by default).
 *
 * The schema name is derived from the `schema` option in the connection
 * config, or falls back to a name derived from the test filename.
 */
export class SchemaPostgresInitializer implements TestDbInitializer<PostgresConnectionOptions> {
    private client: Client;

    async init(
        testFileName: string,
        connectionOptions: PostgresConnectionOptions,
    ): Promise<PostgresConnectionOptions> {
        const schemaName =
            connectionOptions.schema ?? this.getSchemaNameFromFilename(testFileName);

        // Connect to the target database (not 'postgres') so we can create
        // a schema within it.
        this.client = new Client({
            host: connectionOptions.host,
            port: connectionOptions.port,
            user: connectionOptions.username,
            password: connectionOptions.password,
            database: connectionOptions.database,
        });
        await this.client.connect();

        // Drop the schema if it already exists (clean slate), then create it.
        await this.client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await this.client.query(`CREATE SCHEMA "${schemaName}"`);

        // Ensure the connection options point to the isolated schema.
        const modifiedOptions: PostgresConnectionOptions = {
            ...connectionOptions,
            schema: schemaName,
            synchronize: true,
        };

        return modifiedOptions;
    }

    async populate(populateFn: () => Promise<void>): Promise<void> {
        await populateFn();
    }

    destroy(): Promise<void> {
        return this.client.end();
    }

    private getSchemaNameFromFilename(filename: string): string {
        return 'e2e_' + path.basename(filename).replace(/[^a-z0-9_]/gi, '_');
    }
}
