const assert=require('assert'),fs=require('fs'),vm=require('vm');
function api(query,source=null,legacy={}){let delegated;const c={module:{exports:{}},console,require:n=>n==='../db/postgres'?{getPool:()=>({query})}:n==='./documentStore'?{transact:async fn=>fn({query})}:n==='./companySupportApi'?{saveSupport:async(...args)=>{delegated=args;return args[3];}}:n==='./firestoreMigrationAudit'?{firestoreRequest:async path=>path.startsWith('/userProfiles/')?source:legacy.settings||null,decodeDocument:d=>d,queryCollection:legacy.queryCollection||(async()=>[])}:require(n)};vm.runInNewContext(fs.readFileSync(require.resolve('../lib/identityApi'),'utf8'),c);return{...c.module.exports,getDelegated:()=>delegated};}
const req={cdUser:{uid:'member',email:'Member@Example.com'},get:()=> 'Bearer session'};
describe('PostgreSQL identity and invitations',()=>{
 it('looks up invitations using the authenticated email, not a submitted email or owner',async()=>{let lookup;const a=api(async(sql,values)=>{lookup=values;return{rows:[]};});await a.ownInvitation(req);assert.deepStrictEqual(Array.from(lookup),['member@example.com']);});
 it('does not revive removed members through stale invitations or self profile writes',async()=>{for(const status of ['revoked','inactive']){const a=api(async()=>({rows:[{id:'c',status}]}));await assert.rejects(a.saveSelf(req,{ownerUid:'owner',plan:'team'}),/inactive or revoked/);assert.strictEqual(a.getDelegated(),undefined);}});
 it('delegates active self-profile saves through the company permission checks',async()=>{const a=api(async()=>({rows:[{id:'allowed',status:'active',role:'field'}]}));await a.saveSelf(req,{name:'Member'});const d=a.getDelegated();assert.strictEqual(d[0].cdCompany.id,'allowed');assert.strictEqual(d[1],'userProfiles');assert.strictEqual(d[2],'member');});
 it('rejects expired, revoked and someone else’s accepted invitations',async()=>{for(const p of [{status:'revoked'},{status:'accepted',acceptedByUid:'other'},{status:'pending',memberStatus:'inactive'}]){const a=api(async()=>({rows:[{company_id:'c',legacy_payload:p}]}));assert.strictEqual(await a.ownInvitation(req),null);}});
 it('creates invited memberships from the server invitation and commits the profile and acceptance together',async()=>{const writes=[];const a=api(async(sql,params)=>{if(sql.includes('from team_invites'))return{rows:[{company_id:'company',legacy_owner_uid:'owner',legacy_payload:{status:'pending',role:'office'}}]};if(sql.startsWith('insert into users')){writes.push({sql,params});return{rows:[{id:'new-user'}]};}if(sql.startsWith('insert')||sql.startsWith('update'))writes.push({sql,params});return{rows:[]};});const result=await a.saveSelf(req,{ownerUid:'owner',plan:'team',name:'Member',role:'admin',email:'other@example.com'});assert.strictEqual(result.role,'office');assert.strictEqual(result.email,'member@example.com');assert.strictEqual(result.plan,'team');const membership=writes.find(w=>w.sql.includes('insert into company_memberships'));assert.deepStrictEqual(Array.from(membership.params),['company','new-user','office']);assert(writes.some(w=>w.sql.startsWith('update team_invites')));});
 it('does not replace an unmigrated existing Firestore account with an empty company',async()=>{let writes=0;const a=api(async(sql)=>{if(sql.startsWith('insert'))writes++;return{rows:[]};},{name:'existing'});await assert.rejects(a.saveSelf(req,{plan:'trial'}),/verified company migration/);assert.strictEqual(writes,0);});
 it('recovers only the explicitly authorized QA trial and retains its source profile and settings',async()=>{
   const qa={...req,cdUser:{uid:'qa',email:'visual-onboarding-qa2-20261004@example.invalid'}},writes=[];
   const profile={id:'qa',email:qa.cdUser.email,plan:'trial',name:'QA',company:'QA Company',createdAt:123,trialEnd:Date.now()+100000,agreedToTerms:true};
   const settings={id:'qa',companyName:'QA Company',team:[],nextEstNum:8};
   const a=api(async(sql,params)=>{if(sql.startsWith('insert')){writes.push({sql,params});return{rows:[{id:'new'}]};}return{rows:[]};},profile,{settings});
   const result=await a.saveSelf(qa,{plan:'trial',name:'overwrite',company:'wrong'});
   assert.strictEqual(result.name,'QA');assert.strictEqual(result.createdAt,123);
   assert.strictEqual(JSON.parse(writes.find(w=>w.sql.includes('company_settings')).params[1]).nextEstNum,8);
 });
 it('refuses QA recovery when legacy records exist or cannot be verified',async()=>{
   const qa={...req,cdUser:{uid:'qa',email:'visual-onboarding-qa2-20261004@example.invalid'}};
   for(const reader of [async()=>[{id:'business'}],async()=>{throw new Error('read denied');}]){
     let writes=0;const a=api(async(sql)=>{if(sql.startsWith('insert'))writes++;return{rows:[]};},{id:'qa',email:qa.cdUser.email,plan:'trial',trialEnd:Date.now()+100000},{queryCollection:reader});
     await assert.rejects(a.saveSelf(qa,{plan:'trial'}));assert.strictEqual(writes,0);
   }
 });
});
