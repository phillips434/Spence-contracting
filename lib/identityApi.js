const {getPool}=require('../db/postgres');
const {transact}=require('./documentStore');
const {saveSupport}=require('./companySupportApi');
const ACCOUNT_CUTOVER = Date.parse('2026-10-05T00:55:55Z');
function email(req){return String(req.cdUser.email||'').trim().toLowerCase();}
async function selfProfile(req){const row=(await getPool().query('select legacy_payload from users where firebase_uid=$1',[req.cdUser.uid])).rows[0];return row?{id:req.cdUser.uid,...row.legacy_payload}:null;}
async function ownInvitation(req,client=getPool()){
  if(!email(req))return null;
  const rows=(await client.query('select ti.company_id,ti.legacy_payload,c.legacy_owner_uid from team_invites ti join companies c on c.id=ti.company_id where ti.legacy_id=$1',[email(req)])).rows;
  const candidates=rows.filter(r=>r.legacy_payload.memberStatus!=='revoked'&&r.legacy_payload.memberStatus!=='inactive'&&(r.legacy_payload.status==='pending'||(r.legacy_payload.status==='accepted'&&r.legacy_payload.acceptedByUid===req.cdUser.uid)));
  if(candidates.length>1)throw new Error('Multiple invitations require company selection');
  return candidates[0]||null;
}
async function saveSelf(req,input){
  const {id:ignored,...p}=input||{},uid=req.cdUser.uid;
  const memberships=(await getPool().query('select c.id,c.legacy_owner_uid,cm.role,cm.status,u.id as user_id from users u join company_memberships cm on cm.user_id=u.id join companies c on c.id=cm.company_id where u.firebase_uid=$1',[uid])).rows;
  const active=memberships.filter(m=>m.status==='active');
  if(active.length===1){return saveSupport({...req,cdCompany:active[0]},'userProfiles',uid,p);}
  if(memberships.length)throw new Error('Company access is inactive or revoked');
  const existing=await selfProfile(req);
  if(existing)throw new Error('Existing account requires verified company migration');
  // Authentication creation time is server-verified. Older unknown accounts cannot
  // silently acquire an empty workspace after the completed data cutover.
  if(!(p.ownerUid||p.plan==='team') && !(Number(req.cdUser.createdAt)>=ACCOUNT_CUTOVER))throw new Error('Existing account requires verified company migration');
  return transact(async client=>{
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[uid]);
    const raced=(await client.query('select id from users where firebase_uid=$1',[uid])).rows[0];
    if(raced)throw new Error('Profile is already being initialized; retry');
    let cid,owner,role,profile;
    if((p.ownerUid||p.plan==='team')){
      const invitation=await ownInvitation(req,client);
      if(!invitation||invitation.legacy_payload.status!=='pending'||p.ownerUid!==invitation.legacy_owner_uid)throw new Error('A pending invitation for your signed-in email is required');
      cid=invitation.company_id;owner=invitation.legacy_owner_uid;role=['office','field'].includes(invitation.legacy_payload.role)?invitation.legacy_payload.role:'field';
      profile={...p,email:email(req),ownerUid:owner,plan:'team',role,status:'active',createdAt:Date.now(),updatedAt:Date.now()};
      const accepted={...invitation.legacy_payload,status:'accepted',acceptedAt:Date.now(),acceptedByUid:uid};
      await client.query('update team_invites set legacy_payload=$3::jsonb,updated_at=now() where company_id=$1 and legacy_id=$2',[cid,email(req),JSON.stringify(accepted)]);
    }else{
      if(p.plan!=='trial')throw new Error('New accounts must start with a trial');
      role='owner';owner=uid;profile={...p,email:email(req),plan:'trial',status:'active',createdAt:Date.now(),trialEnd:Date.now()+14*24*60*60*1000};
      const company=(await client.query('insert into companies(legacy_owner_uid,name) values($1,$2) returning id',[uid,profile.company||'Contractor Desk'])).rows[0];cid=company.id;
      await client.query('insert into company_settings(company_id,settings_payload) values($1,$2::jsonb)',[cid,JSON.stringify({companyName:profile.company||'Contractor Desk',team:[],nextJobNum:1,nextEstNum:1})]);
      await client.query('insert into company_sequences(company_id) values($1)',[cid]);
    }
    const user=(await client.query('insert into users(firebase_uid,email,display_name,legacy_payload) values($1,$2,$3,$4::jsonb) returning id',[uid,email(req),p.name||null,JSON.stringify(profile)])).rows[0];
    await client.query('insert into company_memberships(company_id,user_id,role,status) values($1,$2,$3,\'active\')',[cid,user.id,role]);
    return profile;
  });
}
function installIdentityRoutes(app){
  app.get('/api/data/identity/self',async(req,res)=>{try{res.json({ok:true,document:await selfProfile(req)});}catch(e){res.status(503).json({ok:false,error:e.message});}});
  app.put('/api/data/identity/self',async(req,res)=>{try{res.json({ok:true,document:await saveSelf(req,req.body)});}catch(e){res.status(403).json({ok:false,error:e.message});}});
  app.get('/api/data/identity/invitation',async(req,res)=>{try{const row=await ownInvitation(req);res.json({ok:true,document:row?{id:email(req),...row.legacy_payload}:null});}catch(e){res.status(409).json({ok:false,error:e.message});}});
}
module.exports={installIdentityRoutes,ownInvitation,saveSelf,selfProfile};
