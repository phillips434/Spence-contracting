const { getPool } = require('../db/postgres');
const { saveProjectDocument,saveEstimateDocument,transact } = require('./documentStore');

const {requireAppUser,trustedOrigin}=require('./authApi');

const OWNER_UID = process.env.CD_OWNER_UID || 'L5XUqfnWrrgbAk18X36XcHDJxnz1';

async function companyIdForOwner(ownerUid = OWNER_UID) {
  const r = await getPool().query('select id from companies where legacy_owner_uid=$1 limit 1',[ownerUid]);
  if (!r.rowCount) throw new Error('Company workspace not found');
  return r.rows[0].id;
}

function cleanDoc(row, ownerUid = OWNER_UID) {
  const doc = row && row.legacy_payload && typeof row.legacy_payload === 'object'
    ? JSON.parse(JSON.stringify(row.legacy_payload)) : {};
  doc.id = row.legacy_id;
  if (!doc.ownerUid) doc.ownerUid = ownerUid;
  if (!doc.userId) doc.userId = ownerUid;
  return doc;
}

async function listDocs(kind, companyId, ownerUid = OWNER_UID) {
  const table = kind === 'projects' ? 'projects' : 'estimates';
  const r = await getPool().query(
    `select legacy_id,legacy_payload from ${table} where company_id=$1 order by created_at,id`,
    [companyId]
  );
  return r.rows.map(row => cleanDoc(row,ownerUid));
}

async function getDoc(kind, companyId, legacyId, ownerUid = OWNER_UID) {
  const table = kind === 'projects' ? 'projects' : 'estimates';
  const r = await getPool().query(
    `select legacy_id,legacy_payload from ${table} where company_id=$1 and legacy_id=$2 limit 1`,
    [companyId,legacyId]
  );
  return r.rowCount ? cleanDoc(r.rows[0],ownerUid) : null;
}

const clientDiagnosticState={};
function installDataRoutes(app) {
  const {installPublicPortalRoutes,installShareRoutes}=require('./publicPortalApi');
  installPublicPortalRoutes(app);
  app.post('/api/data/client-diagnostic',requireAppUser,(req,res)=>{
    const b=req.body||{},kind=String(b.kind||'unknown');
    clientDiagnosticState[kind]={count:Number(b.count)||0,error:b.error?String(b.error).slice(0,200):null,at:Date.now()};
    res.json({ok:true});
  });
  app.get('/api/data/client-diagnostic/latest',requireAppUser,(req,res)=>res.json({ok:true,state:clientDiagnosticState}));
  app.use('/api/data',requireAppUser);
  app.use('/api/data',(req,res,next)=>['GET','HEAD','OPTIONS'].includes(req.method)?next():trustedOrigin(req,res,next));
  const {requireCompany,installSupportRoutes}=require('./companySupportApi');
  require('./identityApi').installIdentityRoutes(app);
  installSupportRoutes(app);
  installShareRoutes(app,requireCompany);
  app.use('/api/data',requireCompany);
  require('./batchApi').installBatchRoutes(app);
  app.get('/api/data/snapshot', async (req,res) => {
    try {
      const companyId = req.cdCompany.id;
      const [projects,estimates] = await Promise.all([
        listDocs('projects',companyId,req.cdCompany.legacy_owner_uid),listDocs('estimates',companyId,req.cdCompany.legacy_owner_uid)
      ]);
      res.json({ok:true,projects,estimates});
    } catch (err) {
      console.error('[DATA API] snapshot failed',err.message);
      res.status(500).json({ok:false,error:'Data unavailable'});
    }
  });

  for (const kind of ['projects','estimates']) {
    app.put('/api/data/'+kind+'/:id', async (req,res) => {
      try {
        const companyId=req.cdCompany.id;
        const document=Object.assign({},req.body||{},{id:req.params.id});
        await transact(async client => {
          if(kind==='projects')await saveProjectDocument(client,companyId,document);
          else await saveEstimateDocument(client,companyId,document);
        });
        res.json({ok:true,document});
      } catch(err) {
        console.error('[DATA API] save failed',kind,err.message);
        res.status(400).json({ok:false,error:'Save failed'});
      }
    });
    app.delete('/api/data/'+kind+'/:id', async (req,res) => {
      try {
        const companyId=req.cdCompany.id;
        const table=kind==='projects'?'projects':'estimates';
        const result=await getPool().query('delete from '+table+' where company_id=$1 and legacy_id=$2',[companyId,req.params.id]);
        if(!result.rowCount)return res.status(404).json({ok:false,error:'Not found'});
        res.json({ok:true});
      } catch(err) {
        console.error('[DATA API] delete failed',kind,err.message);
        res.status(400).json({ok:false,error:'Delete failed'});
      }
    });
    app.get('/api/data/'+kind, async (req,res) => {
      try {
        const companyId = req.cdCompany.id;
        res.json({ok:true,documents:await listDocs(kind,companyId,req.cdCompany.legacy_owner_uid)});
      } catch (err) {
        console.error('[DATA API] list failed',kind,err.message);
        res.status(500).json({ok:false,error:'Data unavailable'});
      }
    });
    app.get('/api/data/'+kind+'/:id', async (req,res) => {
      try {
        const companyId = req.cdCompany.id;
        const doc = await getDoc(kind,companyId,req.params.id,req.cdCompany.legacy_owner_uid);
        if (!doc) return res.status(404).json({ok:false,error:'Not found'});
        res.json({ok:true,document:doc});
      } catch (err) {
        console.error('[DATA API] get failed',kind,err.message);
        res.status(500).json({ok:false,error:'Data unavailable'});
      }
    });
  }
}

module.exports={installDataRoutes,companyIdForOwner,listDocs,getDoc,cleanDoc,requireAppUser};
