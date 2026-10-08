const {getPool}=require('../db/postgres');
const {transact}=require('./documentStore');
const {randomUUID}=require('node:crypto');
async function requireCompany(req,res,next){
  try{
    const r=await getPool().query(`select c.id,c.legacy_owner_uid,cm.role,cm.status,u.id as user_id from users u join company_memberships cm on cm.user_id=u.id join companies c on c.id=cm.company_id where u.firebase_uid=$1 order by cm.created_at`,[req.cdUser.uid]);
    const active=r.rows.filter(x=>x.status==='active');
    if(active.length!==1)return res.status(403).json({ok:false,error:'Active company membership required'});
    req.cdCompany=active[0];next();
  }catch(e){console.error('[COMPANY SESSION]',e.message);res.status(503).json({ok:false,error:'Company session unavailable'});}
}
function privileged(req){return ['owner','admin'].includes(req.cdCompany.role);}
async function supportDocs(req,kind){
  const cid=req.cdCompany.id,uid=req.cdUser.uid;
  if(kind==='settings'){
    const r=await getPool().query('select settings_payload from company_settings where company_id=$1',[cid]);
    return r.rows.map(x=>({id:req.cdCompany.legacy_owner_uid==='L5XUqfnWrrgbAk18X36XcHDJxnz1'?'dropdowns':req.cdCompany.legacy_owner_uid,...x.settings_payload}));
  }
  if(kind==='userProfiles'){
    const r=await getPool().query(`select u.firebase_uid as legacy_id,u.legacy_payload from users u join company_memberships cm on cm.user_id=u.id where cm.company_id=$1`,[cid]);
    return r.rows.filter(x=>privileged(req)||x.legacy_id===uid).map(x=>({id:x.legacy_id,...x.legacy_payload}));
  }
  if(kind==='teamInvites'){
    const r=await getPool().query('select legacy_id,legacy_payload from team_invites where company_id=$1',[cid]);
    return r.rows.filter(x=>privileged(req)||x.legacy_id===String(req.cdUser.email||'').toLowerCase()).map(x=>({id:x.legacy_id,...x.legacy_payload}));
  }
  if(kind==='notifications'){
    const r=await getPool().query(`select n.legacy_id,n.legacy_payload,s.is_read,s.is_hidden from notifications n left join notification_user_state s on s.notification_id=n.id and s.firebase_uid=$2 where n.company_id=$1 and (n.target_firebase_uid is null or n.target_firebase_uid=$2)`,[cid,uid]);
    return r.rows.map(x=>{const p={...x.legacy_payload};if(x.is_read){p.read=true;p.readBy={...p.readBy,[uid]:true};}if(x.is_hidden)p.hiddenBy={...p.hiddenBy,[uid]:true};return{id:x.legacy_id,...p};});
  }
  throw new Error('Unsupported collection');
}
async function saveSettings(client,cid,payload,expected){
  const prior=(await client.query('select settings_payload from company_settings where company_id=$1 for update',[cid])).rows[0];
  if(!prior)throw new Error('Company settings not found');
  const checks=expected===undefined?undefined:{...expected};
  if(checks){delete checks.nextJobNum;delete checks.nextEstNum;}
  const p=checks===undefined?{...prior.settings_payload,...payload}:require('./recordPatch').applyRecordPatch(prior.settings_payload,payload,checks);
  // Counters never move backwards when another member has stale settings.
  p.nextJobNum=Math.max(Number(prior.settings_payload.nextJobNum)||1,Number(p.nextJobNum)||1);
  p.nextEstNum=Math.max(Number(prior.settings_payload.nextEstNum)||1,Number(p.nextEstNum)||1);
  await client.query('update company_settings set settings_payload=$2::jsonb,updated_at=now() where company_id=$1',[cid,JSON.stringify(p)]);
  await client.query('update company_sequences set next_job_number=greatest(next_job_number,$2),next_estimate_number=greatest(next_estimate_number,$3),updated_at=now() where company_id=$1',[cid,p.nextJobNum,p.nextEstNum]);
  if(p.companyName)await client.query('update companies set name=$2,updated_at=now() where id=$1',[cid,p.companyName]);
  return p;
}
async function saveSupport(req,kind,id,input){
  const cid=req.cdCompany.id,uid=req.cdUser.uid;
  const {id:ignored,...p}=input||{};
  return transact(async client=>{
    if(kind==='settings'){
      const expected=req.cdCompany.legacy_owner_uid==='L5XUqfnWrrgbAk18X36XcHDJxnz1'?'dropdowns':req.cdCompany.legacy_owner_uid;
      if(id!==expected)throw new Error('Company settings identity mismatch');
      return saveSettings(client,cid,p);
    }
    if(kind==='userProfiles'){
      const r=await client.query('select u.id,u.legacy_payload from users u join company_memberships cm on cm.user_id=u.id where cm.company_id=$1 and u.firebase_uid=$2 for update of u',[cid,id]);
      if(!r.rowCount||(!privileged(req)&&id!==uid))throw new Error('Profile access denied');
      const before=r.rows[0].legacy_payload||{};
      if(!privileged(req))for(const k of ['ownerUid','plan','role','status'])if(JSON.stringify(p[k])!==JSON.stringify(before[k]))throw new Error('Profile access fields cannot be changed');
      const next={...before,...p};
      if(id!==req.cdCompany.legacy_owner_uid&&next.ownerUid&&next.ownerUid!==req.cdCompany.legacy_owner_uid)throw new Error('Company cannot be changed');
      await client.query('update users set legacy_payload=$2::jsonb,display_name=$3,updated_at=now() where id=$1',[r.rows[0].id,JSON.stringify(next),next.name||null]);
      if(privileged(req)&&id!==req.cdCompany.legacy_owner_uid){
        const status=!next.ownerUid||next.status==='revoked'?'revoked':next.status==='inactive'?'inactive':'active';
        await client.query('update company_memberships set status=$3,updated_at=now() where company_id=$1 and user_id=$2',[cid,r.rows[0].id,status]);
      }
      return next;
    }
    if(kind==='teamInvites'){
      const r=await client.query('select legacy_payload from team_invites where company_id=$1 and legacy_id=$2 for update',[cid,id]);
      if(!privileged(req)){
        if(id!==String(req.cdUser.email||'').toLowerCase()||!r.rowCount)throw new Error('Invitation access denied');
        const allowed=['status','acceptedAt','acceptedByUid'];
        for(const k of Object.keys(p))if(!allowed.includes(k)&&JSON.stringify(p[k])!==JSON.stringify(r.rows[0].legacy_payload[k]))throw new Error('Invitation access fields cannot be changed');
        if(p.acceptedByUid!==uid||p.status!=='accepted')throw new Error('Invitation acceptance mismatch');
      }
      if(p.ownerUid!==req.cdCompany.legacy_owner_uid)throw new Error('Invitation company mismatch');
      await client.query('insert into team_invites(company_id,legacy_id,legacy_payload) values($1,$2,$3::jsonb) on conflict(company_id,legacy_id) do update set legacy_payload=excluded.legacy_payload,updated_at=now()',[cid,id,JSON.stringify(p)]);
      return p;
    }
    if(kind==='notifications'){
      const r=await client.query('select id,legacy_payload,target_firebase_uid from notifications where company_id=$1 and legacy_id=$2 for update',[cid,id]);
      if(r.rowCount){
        const n=r.rows[0];if(n.target_firebase_uid&&n.target_firebase_uid!==uid)throw new Error('Notification access denied');
        const before=n.legacy_payload||{};
        for(const k of Object.keys(p))if(!['read','readBy','hiddenBy'].includes(k)&&JSON.stringify(p[k])!==JSON.stringify(before[k]))throw new Error('Notification content cannot be changed');
        const isRead=!!((p.readBy||{})[uid]||(!before.workspaceUid&&p.read));
        const isHidden=!!((p.hiddenBy||{})[uid]);
        await client.query('insert into notification_user_state(notification_id,firebase_uid,is_read,is_hidden) values($1,$2,$3,$4) on conflict(notification_id,firebase_uid) do update set is_read=notification_user_state.is_read or excluded.is_read,is_hidden=notification_user_state.is_hidden or excluded.is_hidden,updated_at=now()',[n.id,uid,isRead,isHidden]);
        return {...before,readBy:{...before.readBy,[uid]:isRead},hiddenBy:{...before.hiddenBy,[uid]:isHidden}};
      }
      const next={...p,workspaceUid:req.cdCompany.legacy_owner_uid,actorUid:uid,actorName:req.cdUser.email||'Team member',readBy:{},hiddenBy:{}};
      await client.query(`insert into notifications(company_id,legacy_id,text_body,project_name,project_legacy_id,detail,actor_firebase_uid,actor_name,occurred_at,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[cid,id,next.text||'',next.project||null,next.projectId||null,next.detail||null,uid,next.actorName,new Date(next.ts||Date.now()),JSON.stringify(next)]);
      return next;
    }
    throw new Error('Unsupported collection');
  });
}
function installSupportRoutes(app){
  app.patch('/api/data/support/settings/:id',requireCompany,async(req,res)=>{
    try{
      const id=req.cdCompany.legacy_owner_uid==='L5XUqfnWrrgbAk18X36XcHDJxnz1'?'dropdowns':req.cdCompany.legacy_owner_uid;
      if(req.params.id!==id)throw new Error('Company settings identity mismatch');
      const document=await transact(client=>saveSettings(client,req.cdCompany.id,req.body.patch,req.body.expected||{}));
      res.json({ok:true,document});
    }catch(e){res.status(e.status||400).json({ok:false,error:e.message});}
  });
  app.get('/api/data/session',requireCompany,(req,res)=>res.json({ok:true,session:{companyId:req.cdCompany.id,workspaceOwnerUid:req.cdCompany.legacy_owner_uid,role:req.cdCompany.role,status:req.cdCompany.status}}));
  app.get('/api/data/support/:kind',requireCompany,async(req,res)=>{try{res.json({ok:true,documents:await supportDocs(req,req.params.kind)});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  app.get('/api/data/support/:kind/:id',requireCompany,async(req,res)=>{try{const docs=await supportDocs(req,req.params.kind);const document=docs.find(d=>d.id===req.params.id);if(!document)return res.status(404).json({ok:false,error:'Not found'});res.json({ok:true,document});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  app.put('/api/data/support/:kind/:id',requireCompany,async(req,res)=>{try{res.json({ok:true,document:await saveSupport(req,req.params.kind,req.params.id,req.body)});}catch(e){res.status(403).json({ok:false,error:e.message});}});
  app.post('/api/data/support/notifications',requireCompany,async(req,res)=>{try{const id=randomUUID();res.json({ok:true,id,document:await saveSupport(req,'notifications',id,req.body)});}catch(e){res.status(400).json({ok:false,error:e.message});}});
}
module.exports={requireCompany,supportDocs,saveSupport,saveSettings,installSupportRoutes};
