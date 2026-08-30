const { DataSource } = require('typeorm');
const { config } = require('../dist/vendure-config');

async function run() {
  const ds = new DataSource({
    ...config.dbConnectionOptions,
    entities: [],
  });
  await ds.initialize();
  const pending = await ds.showMigrations();
  console.log('Has pending migrations:', pending);
  if (pending) {
    const result = await ds.runMigrations();
    console.log('Migrations ran:', result.length);
  }
  await ds.destroy();
}
run().catch(e => { console.error(e); process.exit(1); });
