const { Pool } = require('pg');

let pool;

function buildPoolConfig() {
  if (process.env.PGHOST && process.env.PGUSER) {
    return {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'railway',
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };
  }
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };
  }
  throw new Error('PostgreSQL connection is not configured');
}

function getPool() {
  if (!pool) pool = new Pool(buildPoolConfig());
  return pool;
}

async function checkDatabase() {
  const result = await getPool().query('select current_database() as database, now() as server_time');
  return result.rows[0];
}

module.exports = { getPool, checkDatabase, buildPoolConfig };
