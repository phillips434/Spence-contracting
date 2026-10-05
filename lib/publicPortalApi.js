const {getPool}=require('../db/postgres');
const {saveProjectDocument,saveEstimateDocument,transact}=require('./documentStore');
const {randomBytes,randomUUID}=require('node:crypto');
const {canonical}=require('./legacySerialization');
const MODES=['portal','est','sub','invoice'];
function indices(scope){return String(scope.scopes??scope.scope??'0').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>=0);}
function pick(doc,keys){return Object.fromEntries(keys.filter(k=>doc[k]!==undefined).map(k=>[k,doc[k]]));}
function projection(p,kind,mode,scope){
  const brand=['companyName','companyPhone','companyEmail','companyAddress','companyPaymentInstructions','logoData'];
  if(kind==='estimates')return pick(p,['id','estNum','validUntil','client','type','address','customerScope','projectClass','residentialSummary','projectScope','workIncluded','conditionsAssumptions','lineItems','tax','notes','exclusions','contractText','contractorName','contractorSigData','contractorSignedAt','signedBy','signedAt','signatureData','status','paymentMilestones',...brand]);
  const base=pick(p,['id','client','clientEmail','type','address','poNum','jobNum','startDate','endDate','status',...brand]);
  if(mode==='invoice'){const idx=Number(scope.ms||0);base.paymentMilestones=(p.paymentMilestones||[]).map((x,i)=>i===idx?x:null);return base;}
  if(mode==='sub'){const allowed=indices(scope);base.scopeItems=(p.scopeItems||[]).map((x,i)=>allowed.includes(i)?x:null);base.dailyLogs=(p.dailyLogs||[]).filter(x=>allowed.includes(Number(x.subScopeIdx)));return base;}
  return {...base,...pick(p,['estimateId','scopeItems','choices','punchList','changeOrders','commsLog','notesLog','paymentMilestones','estimateTotal','clientTotal'])};
}
async function resolveAccess(query,kind,id){
  const mode=String(query.mode||'');const root=String(query.root||id);
  if(!MODES.includes(mode)||!['projects','estimates'].includes(kind))throw new Error('Invalid shared view');
  const rootKind=mode==='est'?'estimates':'projects';
  const pool=getPool();
  const r=await pool.query('select id,company_id,legacy_payload from '+rootKind+' where legacy_id=$1',[root]);
  if(r.rows.length!==1)throw new Error('Shared record not found');
  const record=r.rows[0];let scope={scope:query.scope,scopes:query.scopes,ms:query.ms};
  if(query.token){
    const link=await pool.query('select scope_payload from public_share_links where token=$1 and company_id=$2 and mode=$3 and legacy_id=$4 and revoked_at is null',[String(query.token),record.company_id,mode,root]);
    if(!link.rowCount)throw new Error('Shared link expired or revoked');scope=link.rows[0].scope_payload;
  }else{
    const legacy=await pool.query('select 1 from legacy_public_share_roots where company_id=$1 and kind=$2 and legacy_id=$3',[record.company_id,rootKind,root]);
    if(!legacy.rowCount)throw new Error('A current shared link is required');
  }
  if(kind!==rootKind||id!==root){if(!(mode==='portal'&&kind==='estimates'&&record.legacy_payload.estimateId===id))throw new Error('Record outside shared view');}
  return {mode,root,companyId:record.company_id,scope};
}
function signatureInput(body){
  const name=String(body.name||'').trim(),signature=String(body.signature||'');
  if(!name||name.length>150||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature)||signature.length>2000000)throw new Error('Name and PNG signature required');
  return {name,signature};
}
function applyPortalAction(p,access,b,now=Date.now()){
  const date=new Date(now).toISOString().slice(0,10);
  if(b.action==='estimate-sign'&&access.mode==='est'){
    if(p.converted||['Converted','Declined','Expired'].includes(p.status)||p.signedAt||p.signatureData)throw new Error('Estimate cannot be signed again');
    const s=signatureInput(b);Object.assign(p,{signedBy:s.name,signedAt:now,signatureData:s.signature,status:'Approved'});return;
  }
  if(b.action==='co-sign'&&access.mode==='portal'){
    const co=(p.changeOrders||[])[Number(b.index)];if(!co||!['Sent to Client','Sent'].includes(co.status))throw new Error('Change order is no longer pending');
    if(String(co.id||'')!==String(b.coId||'')||co.title!==b.title||Number(co.budgetImpact||0)!==Number(b.amount))throw new Error('Change order changed; reload before signing');
    const s=signatureInput(b),amount=Number(co.budgetImpact)||0;
    Object.assign(co,{status:'Approved',clientSignedBy:s.name,clientSignedAt:now,clientSigData:s.signature});
    p.scopeItems=p.scopeItems||[];p.scopeItems.push({desc:'[CO] '+co.title,start:'',end:'',budget:amount,actual:0,complete:'Not Started',assignTo:'',assignPhone:'',assignEmail:'',category:'Change Order'});
    p.notesLog=p.notesLog||[];p.notesLog.push({date,weather:'',work:'Change Order Approved by client ('+s.name+'): '+co.title+' — +$'+amount.toLocaleString('en-US'),ts:now});
    p.paymentMilestones=p.paymentMilestones||[];
    const coId=String(co.id||'');if(!coId||!p.paymentMilestones.some(m=>String(m.coId||'')===coId)){
      const m={name:'Change Order: '+co.title,amount,pct:null,paid:false,dueDate:date,isCO:true,dueImmediately:true};if(coId)m.coId=coId;p.paymentMilestones.push(m);p.budget=(Number(p.budget)||0)+amount;p.clientTotal=(Number(p.clientTotal)||0)+amount;
    }
    return;
  }
  if(access.mode==='sub'&&['sub-status','sub-log'].includes(b.action)){
    const idx=Number(b.index);if(!indices(access.scope).includes(idx)||!p.scopeItems?.[idx])throw new Error('Scope is outside assigned work');
    if(b.action==='sub-status'){if(!['Not Started','In Progress','Complete','On Hold'].includes(b.status))throw new Error('Invalid scope status');p.scopeItems[idx].complete=b.status;return;}
    const entry=b.entry||{};if(!String(entry.work||'').trim())throw new Error('Work description required');
    const photos=Array.isArray(entry.photos)?entry.photos:[];if(photos.length>5||photos.some(x=>typeof x!=='string'||x.length>2000000||!/^data:image\/(png|jpeg|webp);base64,/.test(x)))throw new Error('Invalid log photos');
    p.dailyLogs=p.dailyLogs||[];p.dailyLogs.push({date:String(entry.date||date),weather:String(entry.weather||''),crew:p.scopeItems[idx].assignTo||'',work:String(entry.work),issues:String(entry.issues||''),photos,ts:now,subScopeIdx:idx,subEntry:true});return;
  }
  throw new Error('Action is not allowed in this shared view');
}
async function notifySigned(client,companyId,p,action,name){
  const owner=(await client.query('select legacy_owner_uid from companies where id=$1',[companyId])).rows[0];
  if(!owner)throw new Error('Company missing');
  const id=randomUUID(),text=(action==='estimate-sign'?'Estimate signed by ':'Change order approved by ')+name;
  const payload={text,project:p.client||'',projectId:action==='co-sign'?p.id:'',ts:Date.now(),workspaceUid:owner.legacy_owner_uid,actorName:name,readBy:{},hiddenBy:{}};
  await client.query('insert into notifications(company_id,legacy_id,text_body,project_name,project_legacy_id,actor_name,occurred_at,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[companyId,id,text,p.client||null,action==='co-sign'?p.id:null,name,new Date(payload.ts),JSON.stringify(payload)]);
}
function installPublicPortalRoutes(app){
  app.get('/api/public/records/:kind/:id',async(req,res)=>{try{const a=await resolveAccess(req.query,req.params.kind,req.params.id);const table=req.params.kind;const row=(await getPool().query('select legacy_payload from '+table+' where company_id=$1 and legacy_id=$2',[a.companyId,req.params.id])).rows[0];if(!row)return res.status(404).json({ok:false,error:'Not found'});const settings=(await getPool().query('select settings_payload from company_settings where company_id=$1',[a.companyId])).rows[0]?.settings_payload||{};const p={...row.legacy_payload,id:req.params.id};for(const k of ['companyName','companyPhone','companyEmail','companyAddress','companyPaymentInstructions','logoData'])if(!p[k]&&settings[k])p[k]=settings[k];res.json({ok:true,document:projection(p,table,a.mode,a.scope)});}catch(e){res.status(403).json({ok:false,error:e.message});}});
  app.post('/api/public/actions/:kind/:id',async(req,res)=>{try{const a=await resolveAccess(req.query,req.params.kind,req.params.id);if((req.body.action==='estimate-sign'&&req.params.kind!=='estimates')||(req.body.action!=='estimate-sign'&&req.params.kind!=='projects'))throw new Error('Action is outside shared record');let document;await transact(async client=>{const row=(await client.query('select legacy_payload from '+req.params.kind+' where company_id=$1 and legacy_id=$2 for update',[a.companyId,req.params.id])).rows[0];if(!row)throw new Error('Record not found');const p={...row.legacy_payload,id:req.params.id},before=canonical(p);applyPortalAction(p,a,req.body);if(canonical(p)!==before){if(req.params.kind==='projects')await saveProjectDocument(client,a.companyId,p);else await saveEstimateDocument(client,a.companyId,p);}if(['estimate-sign','co-sign'].includes(req.body.action))await notifySigned(client,a.companyId,p,req.body.action,String(req.body.name).trim());document=projection(p,req.params.kind,a.mode,a.scope);});res.json({ok:true,document});}catch(e){res.status(409).json({ok:false,error:e.message});}});
}
function installShareRoutes(app,requireCompany){
  app.post('/api/data/share',requireCompany,async(req,res)=>{try{const mode=String(req.body.mode||''),id=String(req.body.id||'');if(!MODES.includes(mode))throw new Error('Invalid share mode');const table=mode==='est'?'estimates':'projects';const record=(await getPool().query('select legacy_payload from '+table+' where company_id=$1 and legacy_id=$2',[req.cdCompany.id,id])).rows[0];if(!record)throw new Error('Record not found');const scope=req.body.scope||{};if(mode==='sub'&&(!indices(scope).length||indices(scope).some(i=>!record.legacy_payload.scopeItems?.[i])))throw new Error('Assigned scope not found');if(mode==='invoice'&&!record.legacy_payload.paymentMilestones?.[Number(scope.ms||0)])throw new Error('Invoice milestone not found');await getPool().query(require('fs').readFileSync(require('path').join(__dirname,'../db/migrations/006_scoped_share_links.sql'),'utf8'));const token=randomBytes(32).toString('hex');await getPool().query('insert into public_share_links(token,company_id,mode,legacy_id,scope_payload) values($1,$2,$3,$4,$5::jsonb)',[token,req.cdCompany.id,mode,id,JSON.stringify(scope)]);const params=new URLSearchParams({[mode]:id,token});for(const[k,v]of Object.entries(scope))if(['ms','scope','scopes'].includes(k))params.set(k,String(v));res.json({ok:true,query:params.toString()});}catch(e){res.status(400).json({ok:false,error:e.message});}});
  app.post('/api/data/share/revoke',requireCompany,async(req,res)=>{try{const r=await getPool().query('update public_share_links set revoked_at=now() where token=$1 and company_id=$2',[String(req.body.token||''),req.cdCompany.id]);res.json({ok:!!r.rowCount});}catch(e){res.status(400).json({ok:false,error:'Link could not be revoked'});}});
}
module.exports={installPublicPortalRoutes,installShareRoutes,resolveAccess,applyPortalAction,projection,indices};
