const { getPool } = require('../db/postgres');
const { saveProjectDocument,saveEstimateDocument,transact } = require('./documentStore');

const FIREBASE_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyCnpDrdLOH_RhCFK9MSD--KWDy--vZmeao';

async function requireFirebaseUser(req,res,next){
  const header=String(req.get('authorization')||'');
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  if(!token)return res.status(401).json({ok:false,error:'Authentication required'});
  try{
    const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(FIREBASE_API_KEY),{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token})
    });
    if(!response.ok)return res.status(401).json({ok:false,error:'Invalid session'});
    const data=await response.json();
    const user=data&&data.users&&data.users[0];
    if(!user||!user.localId)return res.status(401).json({ok:false,error:'Invalid session'});
    req.cdUser={uid:user.localId,email:user.email||null};
    next();
  }catch(err){console.error('[DATA API] auth verification failed',err.message);res.status(503).json({ok:false,error:'Authentication verification unavailable'});}
}

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


async function getCompanySettings(companyId) {
  const r=await getPool().query('select settings_payload from company_settings where company_id=$1',[companyId]);
  return r.rowCount ? r.rows[0].settings_payload : null;
}
async function saveCompanySettings(companyId,payload) {
  const doc=payload&&typeof payload==='object'?payload:{};
  const client=await getPool().connect();
  try{
    await client.query('begin');
    await client.query(`insert into company_settings(company_id,settings_payload,updated_at)
      values($1,$2::jsonb,now())
      on conflict(company_id) do update set settings_payload=excluded.settings_payload,updated_at=now()`,[companyId,JSON.stringify(doc)]);
    const nextJob=Math.max(1,Number(doc.nextJobNum)||1),nextEst=Math.max(1,Number(doc.nextEstNum)||1);
    await client.query(`insert into company_sequences(company_id,next_job_number,next_estimate_number)
      values($1,$2,$3)
      on conflict(company_id) do update set
        next_job_number=greatest(company_sequences.next_job_number,excluded.next_job_number),
        next_estimate_number=greatest(company_sequences.next_estimate_number,excluded.next_estimate_number),
        updated_at=now()`,[companyId,nextJob,nextEst]);
    if(doc.companyName)await client.query('update companies set name=$1,updated_at=now() where id=$2',[String(doc.companyName),companyId]);
    await client.query('commit');
    return doc;
  }catch(err){await client.query('rollback');throw err;}finally{client.release();}
}

function installDataRoutes(app) {
  app.use('/api/data',requireFirebaseUser);
  app.get('/api/data/settings',async(req,res)=>{try{const companyId=await companyIdForOwner();const document=await getCompanySettings(companyId);if(!document)return res.status(404).json({ok:false,error:'Not found'});res.json({ok:true,document});}catch(err){console.error('[DATA API] settings read failed',err.message);res.status(500).json({ok:false,error:'Data unavailable'});}});
  app.put('/api/data/settings',async(req,res)=>{try{const companyId=await companyIdForOwner();const document=await saveCompanySettings(companyId,req.body||{});res.json({ok:true,document});}catch(err){console.error('[DATA API] settings save failed',err.message);res.status(400).json({ok:false,error:'Save failed'});}});

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
    app.put('/api/data/'+kind+'/:id', async (req,res) => {
      try {
        const companyId=await companyIdForOwner();
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
        const companyId=await companyIdForOwner();
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

module.exports={installDataRoutes,companyIdForOwner,listDocs,getDoc,cleanDoc,requireFirebaseUser,getCompanySettings,saveCompanySettings};
