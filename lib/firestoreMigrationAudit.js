const {getPool}=require('../db/postgres');
const {createHash}=require('node:crypto');
const OWNER_UID=process.env.CD_OWNER_UID||'L5XUqfnWrrgbAk18X36XcHDJxnz1';
const PROJECT=process.env.FIREBASE_PROJECT_ID||'spence-contracting';
function decodeValue(v){
  if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decodeValue(x)]));
  if(v.arrayValue)return (v.arrayValue.values||[]).map(decodeValue);
  for(const k of ['stringValue','booleanValue','timestampValue','nullValue'])if(k in v)return v[k];
  if('integerValue' in v)return Number(v.integerValue);
  if('doubleValue' in v)return v.doubleValue;
  return v;
}
function decodeDocument(d){return {id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decodeValue(v)]))};}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(canonical(v)).digest('hex');}
async function firestoreRequest(path,token,body){
  const r=await fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(r.status===404&&!body)return null;
  if(!r.ok){const e=new Error('Firestore read denied or unavailable ('+r.status+')');e.status=r.status;throw e;}
  return r.json();
}
async function queryCollection(collection,field,value,token){
  const structuredQuery={from:[{collectionId:collection}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}}};
  const result=await firestoreRequest(':runQuery',token,{structuredQuery});
  return result.filter(x=>x.document).map(x=>decodeDocument(x.document));
}
async function readOwnerSupport(token){
  const result={collections:{},unavailable:[]};
  const requests={
    userProfiles:async()=>{const own=await firestoreRequest('/userProfiles/'+encodeURIComponent(OWNER_UID),token);return [...(own?[decodeDocument(own)]:[]),...await queryCollection('userProfiles','ownerUid',OWNER_UID,token)];},
    teamInvites:()=>queryCollection('teamInvites','ownerUid',OWNER_UID,token),
    notifications:async()=>[...await queryCollection('notifications','userId',OWNER_UID,token),...await queryCollection('notifications','workspaceUid',OWNER_UID,token)]
  };
  await Promise.all(Object.entries(requests).map(async([kind,run])=>{try{const docs=await run();result.collections[kind]=[...new Map(docs.map(d=>[d.id,d])).values()];}catch(e){result.unavailable.push({collection:kind,status:e.status||503});}}));
  if(result.collections.userProfiles&&result.collections.notifications){
    try{for(const profile of result.collections.userProfiles){if(profile.id!==OWNER_UID)result.collections.notifications.push(...await queryCollection('notifications','userId',profile.id,token));}result.collections.notifications=[...new Map(result.collections.notifications.map(d=>[d.id,d])).values()];}catch(e){result.unavailable.push({collection:'notifications',status:e.status||503});}
  }
  return result;
}
async function auditOwnerSupport(token){
  const source=await readOwnerSupport(token);
  const counts=Object.fromEntries(Object.entries(source.collections).map(([k,docs])=>[k,docs.length]));
  const company=(await getPool().query('select id from companies where legacy_owner_uid=$1',[OWNER_UID])).rows[0];
  if(!company)throw new Error('Company missing');
  const verification={};
  const targets={userProfiles:"select u.firebase_uid as legacy_id,u.legacy_payload from users u join company_memberships cm on cm.user_id=u.id where cm.company_id=$1",teamInvites:'select legacy_id,legacy_payload from team_invites where company_id=$1',notifications:'select legacy_id,legacy_payload from notifications where company_id=$1'};
  for(const[k,sql]of Object.entries(targets)){
    const destination=(await getPool().query(sql,[company.id])).rows;
    const byId=new Map(destination.map(r=>[r.legacy_id,r.legacy_payload]));
    const docs=source.collections[k]||[],missing=[],different=[];
    for(const {id,...payload} of docs){if(!byId.has(id))missing.push(id);else if(digest(payload)!==digest(byId.get(id)))different.push(id);}
    verification[k]={source:docs.length,destination:destination.length,exact:docs.length-missing.length-different.length,missing,different};
  }
  const settingsDoc=await firestoreRequest('/settings/dropdowns',token),settings=(await getPool().query('select settings_payload from company_settings where company_id=$1',[company.id])).rows[0];
  const {id:ignored,...sourceSettings}=decodeDocument(settingsDoc);
  return {sourceCounts:counts,unavailable:source.unavailable,verification,settingsMatch:digest(sourceSettings)===digest(settings?.settings_payload)};
}
async function migrateOwnerSupport(token){
  const source=await readOwnerSupport(token);
  if(source.unavailable.length)throw new Error('Protected source collections could not all be read');
  const settingDoc=await firestoreRequest('/settings/dropdowns',token);
  if(!settingDoc)throw new Error('Company settings source missing');
  const {id:settingId,...settings}=decodeDocument(settingDoc);
  const client=await getPool().connect();
  try{
    await client.query('begin');
    const company=(await client.query('select id from companies where legacy_owner_uid=$1',[OWNER_UID])).rows[0];
    if(!company)throw new Error('Company missing');
    // Additive schema and records only; existing project/estimate records are never touched.
    await client.query(require('fs').readFileSync(require('path').join(__dirname,'../db/migrations/005_identity_and_invites.sql'),'utf8'));
    const verified={};
    for(const p of source.collections.userProfiles){
      const {id,...payload}=p;
      await client.query('insert into users(firebase_uid,email,display_name,legacy_payload) values($1,$2,$3,$4::jsonb) on conflict(firebase_uid) do nothing',[id,p.email||null,p.name||null,JSON.stringify(payload)]);
      const row=(await client.query('select id,legacy_payload from users where firebase_uid=$1',[id])).rows[0];
      if(digest(row.legacy_payload)!==digest(payload))throw new Error('Existing profile differs; migration stopped');
      const role=id===OWNER_UID?'owner':(['admin','office','field'].includes(String(p.role).toLowerCase())?String(p.role).toLowerCase():'field');
      const status=['inactive','revoked'].includes(p.status)?p.status:'active';
      await client.query('insert into company_memberships(company_id,user_id,role,status) values($1,$2,$3,$4) on conflict(company_id,user_id) do nothing',[company.id,row.id,role,status]);
    }
    for(const invite of source.collections.teamInvites){
      const {id,...payload}=invite;
      await client.query('insert into team_invites(company_id,legacy_id,legacy_payload) values($1,$2,$3::jsonb) on conflict(company_id,legacy_id) do nothing',[company.id,id,JSON.stringify(payload)]);
      const row=(await client.query('select legacy_payload from team_invites where company_id=$1 and legacy_id=$2',[company.id,id])).rows[0];
      if(digest(row.legacy_payload)!==digest(payload))throw new Error('Existing invitation differs; migration stopped');
    }
    for(const notification of source.collections.notifications){
      const {id,...p}=notification;
      await client.query(`insert into notifications(company_id,legacy_id,target_firebase_uid,text_body,project_name,project_legacy_id,detail,actor_firebase_uid,actor_name,occurred_at,legacy_payload)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) on conflict(company_id,legacy_id) do nothing`,[company.id,id,p.userId||null,p.text||'',p.project||null,p.projectId||null,p.detail||null,p.actorUid||null,p.actorName||null,p.ts?new Date(p.ts):null,JSON.stringify(p)]);
      const row=(await client.query('select legacy_payload from notifications where company_id=$1 and legacy_id=$2',[company.id,id])).rows[0];
      if(digest(row.legacy_payload)!==digest(p))throw new Error('Existing notification differs; migration stopped');
    }
    const previous=(await client.query('select settings_payload from company_settings where company_id=$1 for update',[company.id])).rows[0];
    if(!previous)throw new Error('PostgreSQL company settings missing');
    const comparable={...previous.settings_payload};
    // The earlier importer represented the empty team array as null. Correct only that proven decoder error.
    if(comparable.team===null&&Array.isArray(settings.team)&&settings.team.length===0){comparable.team=[];await client.query("update company_settings set settings_payload=jsonb_set(settings_payload,'{team}','[]'::jsonb),updated_at=now() where company_id=$1",[company.id]);}
    if(digest(comparable)!==digest(settings))throw new Error('Company settings differ beyond the empty-array correction');
    for(const[k,docs]of Object.entries(source.collections))verified[k]={source:docs.length,verified:docs.length};
    await client.query('commit');
    return {verified,settingsMatch:true,projectsAndEstimatesChanged:false};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}
module.exports={decodeValue,decodeDocument,canonical,digest,firestoreRequest,queryCollection,readOwnerSupport,auditOwnerSupport,migrateOwnerSupport,OWNER_UID};
