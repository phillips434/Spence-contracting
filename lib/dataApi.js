const { getPool } = require('./db/postgres');

const OWNER_UID = process.env.CD_OWNER_UID || 'L5XUqfnWrrgbAk18X36XcHDJxnz1';

async function companyIdForOwner(ownerUid = OWNER_UID) {
  const r = await getPool().query('select id from companies where legacy_owner_uid=$1 limit 1',[ownerUid]);
  if (!r.rowCount) throw new Error('Company workspace not found');
  return r.rows[0].id;
}

function cleanDoc(row) {
  const doc = row && row.legacy_payload && typeof row.legacy_payload === 'object'
    ? JSON.parse(JSON.stringify(row.legacy_payload)) : {};
  doc.id = row.legacy_id;
  return doc;
}

async function listDocs(kind, companyId) {
  const table = kind === 'projects' ? 'projects' : 'estimates';
  const r = await getPool().query(
    `select legacy_id,legacy_payload from ${table} where company_id=$1 order by created_at,id`,
    [companyId]
  );
  return r.rows.map(cleanDoc);
}

async function getDoc(kind, companyId, legacyId) {
  const table = kind === 'projects' ? 'projects' : 'estimates';
  const r = await getPool().query(
    `select legacy_id,legacy_payload from ${table} where company_id=$1 and legacy_id=$2 limit 1`,
    [companyId,legacyId]
  );
  return r.rowCount ? cleanDoc(r.rows[0]) : null;
}

function installDataRoutes(app) {
  app.get('/api/data/snapshot', async (req,res) => {
    try {
      const companyId = await companyIdForOwner();
      const [projects,estimates] = await Promise.all([
        listDocs('projects',companyId),listDocs('estimates',companyId)
      ]);
      res.json({ok:true,projects,estimates});
    } catch (err) {
      console.error('[DATA API] snapshot failed',err.message);
      res.status(500).json({ok:false,error:'Data unavailable'});
    }
  });

  for (const kind of ['projects','estimates']) {
    app.get('/api/data/'+kind, async (req,res) => {
      try {
        const companyId = await companyIdForOwner();
        res.json({ok:true,documents:await listDocs(kind,companyId)});
      } catch (err) {
        console.error('[DATA API] list failed',kind,err.message);
        res.status(500).json({ok:false,error:'Data unavailable'});
      }
    });
    app.get('/api/data/'+kind+'/:id', async (req,res) => {
      try {
        const companyId = await companyIdForOwner();
        const doc = await getDoc(kind,companyId,req.params.id);
        if (!doc) return res.status(404).json({ok:false,error:'Not found'});
        res.json({ok:true,document:doc});
      } catch (err) {
        console.error('[DATA API] get failed',kind,err.message);
        res.status(500).json({ok:false,error:'Data unavailable'});
      }
    });
  }
}

module.exports={installDataRoutes,companyIdForOwner,listDocs,getDoc,cleanDoc};
