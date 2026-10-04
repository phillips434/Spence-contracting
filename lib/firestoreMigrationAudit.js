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
  return result;
}
async function auditOwnerSupport(token){
  const source=await readOwnerSupport(token);
  const counts=Object.fromEntries(Object.entries(source.collections).map(([k,docs])=>[k,docs.length]));
  const columns=(await getPool().query("select table_name,column_name from information_schema.columns where table_schema='public' and table_name=ANY($1)",[['users','company_memberships','notifications','company_settings']])).rows;
  return {sourceCounts:counts,unavailable:source.unavailable,schema:columns};
}
module.exports={decodeValue,decodeDocument,canonical,digest,firestoreRequest,queryCollection,readOwnerSupport,auditOwnerSupport,OWNER_UID};
