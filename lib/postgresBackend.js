const { getPool, checkDatabase } = require('./db/postgres');

function dataBackendEnabled() {
  return String(process.env.CD_DATA_BACKEND || 'firestore').toLowerCase() === 'postgres';
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

function installPostgresRoutes(app) {
  app.get('/api/backend/health', async (req,res) => {
    if (!process.env.DATABASE_URL) return res.status(503).json({ok:false,database:'not-configured',activeBackend:process.env.CD_DATA_BACKEND||'firestore'});
    try {
      const db = await checkDatabase();
      return res.json({ok:true,database:db.database,activeBackend:process.env.CD_DATA_BACKEND||'firestore'});
    } catch (err) {
      return res.status(503).json({ok:false,database:'unreachable',activeBackend:process.env.CD_DATA_BACKEND||'firestore'});
    }
  });
}

module.exports = { dataBackendEnabled, reserveCompanyJobNumber, installPostgresRoutes };
