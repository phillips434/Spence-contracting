const { getPool, checkDatabase } = require('../db/postgres');

function dataBackendEnabled() {
  return true;
}

async function reserveCompanyJobNumber(companyId) {
  if (!companyId) throw new Error('companyId is required');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into company_sequences(company_id,next_job_number,next_estimate_number)
       values($1,1,1) on conflict(company_id) do nothing`,
      [companyId]
    );
    const result = await client.query(
      `update company_sequences
       set next_job_number=next_job_number+1, updated_at=now()
       where company_id=$1
       returning next_job_number-1 as reserved_number`,
      [companyId]
    );
    if (!result.rowCount) throw new Error('Company sequence not found');
    await client.query('commit');
    return Number(result.rows[0].reserved_number);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

function migrationAuthorized(req) {
  const enabled = String(process.env.CD_MIGRATION_MODE || '').toLowerCase() === 'enabled';
  const expected = process.env.CD_MIGRATION_SECRET || '';
  const supplied = req.get('x-cd-migration-secret') || '';
  return enabled && expected.length >= 24 && supplied === expected;
}

async function reconciliationForCompany(companyId) {
  const r = await getPool().query(`select
    (select count(*)::int from projects where company_id=$1) as projects,
    (select count(*)::int from estimates where company_id=$1) as estimates,
    (select count(*)::int from estimate_items ei join estimates e on e.id=ei.estimate_id where e.company_id=$1) as estimate_line_items,
    (select count(*)::int from project_selections ps join projects p on p.id=ps.project_id where p.company_id=$1) as selections,
    (select count(*)::int from change_orders co join projects p on p.id=co.project_id where p.company_id=$1) as change_orders,
    (select count(*)::int from daily_logs dl join projects p on p.id=dl.project_id where p.company_id=$1) as daily_logs,
    (select count(*)::int from communications c join projects p on p.id=c.project_id where p.company_id=$1) as communications,
    (select count(*)::int from project_costs pc join projects p on p.id=pc.project_id where p.company_id=$1) as costs,
    (select coalesce(sum(budget),0)::numeric from projects where company_id=$1) as project_budget,
    (select coalesce(sum(spent),0)::numeric from projects where company_id=$1) as project_spent`,[companyId]);
  return r.rows[0];
}

function installPostgresRoutes(app) {
  app.post('/api/migration/import-backup', async (req,res) => {
    if (!migrationAuthorized(req)) return res.status(404).json({error:'Not found'});
    try {
      const { importBackup } = require('./importCompanyBackup');
      const imported = await importBackup(req.body);
      const reconciliation = await reconciliationForCompany(imported.companyId);
      return res.json({ok:true,imported,reconciliation});
    } catch (err) {
      console.error('[POSTGRES MIGRATION] import failed',err);
      return res.status(400).json({ok:false,error:err.message});
    }
  });

  app.get('/api/backend/health', async (req,res) => {
    if (!process.env.DATABASE_URL && !(process.env.PGHOST && process.env.PGUSER)) return res.status(503).json({ok:false,database:'not-configured',activeBackend:'postgres'});
    try {
      const db = await checkDatabase();
      return res.json({ok:true,database:db.database,activeBackend:'postgres'});
    } catch (err) {
      return res.status(503).json({ok:false,database:'unreachable',activeBackend:'postgres'});
    }
  });
}

module.exports = { dataBackendEnabled, reserveCompanyJobNumber, installPostgresRoutes, migrationAuthorized, reconciliationForCompany };

