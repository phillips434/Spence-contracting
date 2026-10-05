const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
function api(query,fetchImpl){const context={process:{env:{}},fetch:fetchImpl,module:{exports:{}},console,URLSearchParams,require:name=>name==='../db/postgres'?{getPool:()=>({query})}:name==='./documentStore'?{}:name==='./estimatePaymentSafety'?require('../lib/estimatePaymentSafety'):name==='./legacySerialization'?require('../lib/legacySerialization'):require(name)};vm.runInNewContext(fs.readFileSync(require.resolve('../lib/publicPortalApi'),'utf8'),context);return context.module.exports;}
const signature='data:image/png;base64,YQ==';
describe('PostgreSQL public portals',()=>{
 it('uses current company branding without rewriting saved business records',()=>{
   const record={companyName:'Old company',logoData:'old-logo',budget:120},before=JSON.stringify(record);
   const p=api().applyCompanyBrand(record,{companyName:'Spence Construction',logoData:'new-logo'});
   assert.strictEqual(p.companyName,'Spence Construction');assert.strictEqual(p.logoData,'new-logo');assert.strictEqual(p.budget,120);assert.strictEqual(JSON.stringify(record),before);
   assert.strictEqual(api().applyCompanyBrand(record,{logoData:''}).logoData,'');
 });
 it('blocks a stale payment schedule before accepting a signature or changing a record',()=>{
   const p={status:'Draft',lineItems:[{total:170,markup:20}],paymentMilestones:[{amount:170}]},before=JSON.stringify(p);
   assert.throws(()=>api().applyPortalAction(p,{mode:'est'},{action:'estimate-sign',name:'QA',signature},10),/Payment schedule needs review/);
   assert.strictEqual(JSON.stringify(p),before);
   p.paymentMilestones[0].amount=204;api().applyPortalAction(p,{mode:'est'},{action:'estimate-sign',name:'QA',signature},10);assert.strictEqual(p.status,'Approved');
 });
 it('accepts a prepared change order without representing composer opening as delivery',()=>{
   const p={changeOrders:[{id:'qa',title:'QA',status:'Ready for Client Review',budgetImpact:25}],scopeItems:[],paymentMilestones:[]};
   api().applyPortalAction(p,{mode:'portal'},{action:'co-sign',index:0,coId:'qa',title:'QA',amount:25,name:'QA',signature},10);
   assert.strictEqual(p.changeOrders[0].status,'Approved');assert.strictEqual(p.paymentMilestones[0].amount,25);
 });
 it('rejects malformed photo payloads without appending a daily log',()=>{
  const p={scopeItems:[{assignTo:'Crew'}],dailyLogs:[]},access={mode:'sub',scope:{scope:0}},a=api();
  for(const photo of ['data:image/png;base64,YQ==" onerror="alert(1)','data:image/png;base64,','data:image/png;base64,not base64','data:image/svg+xml;base64,YQ==']){
   assert.throws(()=>a.applyPortalAction(p,access,{action:'sub-log',index:0,entry:{work:'Fixture work',photos:[photo]}}),/Invalid log photos/);assert.strictEqual(p.dailyLogs.length,0);
  }
  a.applyPortalAction(p,access,{action:'sub-log',index:0,entry:{work:'Fixture work',photos:[signature]}});assert.strictEqual(p.dailyLogs[0].photos[0],signature);
 });
 it('preserves customer scope, prices and existing signatures in estimate views',()=>{const p={id:'e',customerScope:{projectScope:'Agreed scope'},lineItems:[{total:100,markup:20}],signedAt:5,signatureData:signature,privateMemo:'secret'};const d=api().projection(p,'estimates','est',{});assert.deepStrictEqual(d.customerScope,p.customerScope);assert.deepStrictEqual(d.lineItems,p.lineItems);assert.strictEqual(d.signatureData,signature);assert.strictEqual(d.privateMemo,undefined);});
 it('shows only the assigned invoice and subcontractor scope',()=>{const p={id:'p',budget:1000,spent:500,costs:[{}],paymentMilestones:[{amount:100},{amount:200}],scopeItems:[{desc:'one'},{desc:'two'}],dailyLogs:[{subScopeIdx:0},{subScopeIdx:1}]};const a=api();const invoice=a.projection(p,'projects','invoice',{ms:1});assert.strictEqual(invoice.paymentMilestones[0],null);assert.strictEqual(invoice.paymentMilestones[1].amount,200);assert.strictEqual(invoice.budget,undefined);const sub=a.projection(p,'projects','sub',{scope:1});assert.strictEqual(sub.scopeItems[0],null);assert.strictEqual(sub.scopeItems[1].desc,'two');assert.strictEqual(sub.dailyLogs.length,1);assert.strictEqual(sub.spent,undefined);});
 it('signs an estimate without changing amounts, attachments or unrelated fields, then rejects a second signature',()=>{const p={status:'Sent to Client',lineItems:[{total:100}],attachments:['photo'],notes:'existing'};const a=api();a.applyPortalAction(p,{mode:'est'},{action:'estimate-sign',name:'Client',signature},10);assert.strictEqual(p.status,'Approved');assert.strictEqual(p.signedAt,10);assert.deepStrictEqual(p.lineItems,[{total:100}]);assert.deepStrictEqual(p.attachments,['photo']);assert.throws(()=>a.applyPortalAction(p,{mode:'est'},{action:'estimate-sign',name:'Other',signature},20),/again/);});
 it('approves sent change orders once with the existing accounting behavior',()=>{const p={budget:100,clientTotal:120,spent:25,changeOrders:[{id:'co',title:'Addition',status:'Sent to Client',budgetImpact:20}],scopeItems:[],paymentMilestones:[],costs:[{actualAmt:25}]};const a=api(),b={action:'co-sign',index:0,coId:'co',title:'Addition',amount:20,name:'Client',signature};a.applyPortalAction(p,{mode:'portal'},b,10);assert.strictEqual(p.budget,120);assert.strictEqual(p.clientTotal,140);assert.strictEqual(p.spent,25);assert.strictEqual(p.paymentMilestones.length,1);assert.strictEqual(p.scopeItems.length,1);assert.throws(()=>a.applyPortalAction(p,{mode:'portal'},b,20),/pending/);assert.strictEqual(p.budget,120);assert.strictEqual(p.paymentMilestones.length,1);});
 it('rejects altered amounts and wrong actions before mutating a record',()=>{const p={changeOrders:[{title:'Addition',status:'Sent',budgetImpact:20}]},before=JSON.stringify(p);assert.throws(()=>api().applyPortalAction(p,{mode:'portal'},{action:'co-sign',index:0,title:'Addition',amount:1,name:'Client',signature}),/changed/);assert.strictEqual(JSON.stringify(p),before);assert.throws(()=>api().applyPortalAction(p,{mode:'invoice'},{action:'estimate-sign',name:'Client',signature}),/not allowed/);});
 it('accepts On Hold and keeps subcontractor actions inside the assigned scope',()=>{const p={scopeItems:[{complete:'Not Started'},{complete:'Not Started',assignTo:'Crew'}],dailyLogs:[{work:'Previous'}]},a=api(),access={mode:'sub',scope:{scope:1}};assert.throws(()=>a.applyPortalAction(p,access,{action:'sub-status',index:0,status:'Complete'}),/outside/);a.applyPortalAction(p,access,{action:'sub-status',index:1,status:'On Hold'});a.applyPortalAction(p,access,{action:'sub-log',index:1,entry:{work:'New work',crew:'Impersonated',photos:[signature]}},10);assert.strictEqual(p.scopeItems[1].complete,'On Hold');assert.strictEqual(p.dailyLogs.length,2);assert.strictEqual(p.dailyLogs[1].crew,'Crew');});
 it('uses stored token scope and denies revoked links without a Firestore fallback',async()=>{let fetched=false;const a=api(async(sql)=>sql.includes('public_share_links')?{rows:[],rowCount:0}:{rows:[{company_id:'c',legacy_payload:{}}]},async()=>{fetched=true;});await assert.rejects(a.resolveAccess({mode:'sub',root:'p',token:'revoked',scope:'3'},'projects','p'),/revoked/);assert.strictEqual(fetched,false);const b=api(async(sql)=>sql.includes('public_share_links')?{rows:[{scope_payload:{scope:1}}],rowCount:1}:{rows:[{company_id:'c',legacy_payload:{}}]});const access=await b.resolveAccess({mode:'sub',root:'p',token:'valid',scope:'3'},'projects','p');assert.strictEqual(access.scope.scope,1);});
 it('denies records outside the shared project even when a token is valid',async()=>{const a=api(async(sql)=>sql.includes('public_share_links')?{rows:[{scope_payload:{}}],rowCount:1}:{rows:[{company_id:'c',legacy_payload:{estimateId:'linked'}}]});await assert.rejects(a.resolveAccess({mode:'portal',root:'p',token:'valid'},'estimates','other'),/outside/);const permitted=await a.resolveAccess({mode:'portal',root:'p',token:'valid'},'estimates','linked');assert.strictEqual(permitted.companyId,'c');});
 it('preserves only allowlisted legacy public links without a remote database read',async()=>{
   let fetched=false;const a=api(async sql=>sql.includes('legacy_public_share_roots')?{rowCount:1,rows:[{}]}:{rows:[{company_id:'c',legacy_payload:{}}]},async()=>{fetched=true;throw new Error('Remote read forbidden');});
   assert.strictEqual((await a.resolveAccess({mode:'portal',root:'p'},'projects','p')).companyId,'c');assert.strictEqual(fetched,false);
   const denied=api(async sql=>sql.includes('legacy_public_share_roots')?{rowCount:0,rows:[]}:{rows:[{company_id:'c',legacy_payload:{}}]});
   await assert.rejects(denied.resolveAccess({mode:'portal',root:'new'},'projects','new'),/current shared link/);
 });
});
