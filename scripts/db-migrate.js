const fs = require('fs');
const path = require('path');
const { getPool } = require('../db/postgres');

async function main() {
  const pool = getPool();
  await pool.query(`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )`);
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const filename of files) {
    const seen = await pool.query('select 1 from schema_migrations where filename=$1', [filename]);
    if (seen.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(filename) values($1)', [filename]);
      await client.query('commit');
      console.log('applied', filename);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.end();
}
main().catch(err => { console.error(err); process.exit(1); });
