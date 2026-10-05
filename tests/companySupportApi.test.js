const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
function api(query){const context={process:{env:{}},module:{exports:{}},console,require:name=>name==='../db/postgres'?{getPool:()=>({query})}:name==='./documentStore'?{transact:async fn=>fn({query})}:name==='./recordPatch'?require('../lib/recordPatch'):require(name)};vm.runInNewContext(fs.readFileSync(require.resolve('../lib/companySupportApi'),'utf8'),context);return context.module.exports;}
describe('PostgreSQL company authorization',function(){
  it('merges settings edits with concurrent unrelated changes and keeps counters monotonic',async()=>{
    let saved;const prior={companyName:'New remote name',companyPhone:'Old phone',nextJobNum:10,nextEstNum:20};
    const a=api(async(sql,params)=>{if(sql.startsWith('select settings_payload'))return{rows:[{settings_payload:prior}]};if(sql.startsWith('update company_settings'))saved=JSON.parse(params[1]);return{rows:[]};});
    const result=await a.saveSettings({query:async(sql,params)=>{if(sql.startsWith('select settings_payload'))return{rows:[{settings_payload:prior}]};if(sql.startsWith('update company_settings'))saved=JSON.parse(params[1]);return{rows:[]};}},'company',{companyPhone:'Edited phone',nextJobNum:8,nextEstNum:19},{companyPhone:{exists:true,value:'Old phone'},nextJobNum:{exists:true,value:7},nextEstNum:{exists:true,value:18}});
    assert.equal(result.companyName,'New remote name');assert.equal(result.companyPhone,'Edited phone');assert.equal(saved.nextJobNum,10);assert.equal(saved.nextEstNum,20);
  });
  it('rejects stale settings edits before changing any company table',async()=>{
    let writes=0;const client={query:async(sql)=>{if(sql.startsWith('select settings_payload'))return{rows:[{settings_payload:{companyPhone:'Remote edit'}}]};writes++;return{rows:[]};}};
    await assert.rejects(api().saveSettings(client,'company',{companyPhone:'Stale edit'},{companyPhone:{exists:true,value:'Original'}}),/Another person changed companyPhone/);assert.equal(writes,0);
  });
  it('denies authenticated users without company membership',async function(){let next=false,status,body;await api(async()=>({rows:[]})).requireCompany({cdUser:{uid:'outside'}},{status:n=>{status=n;return{json:b=>body=b};}},()=>next=true);assert.strictEqual(next,false);assert.strictEqual(status,403);assert.strictEqual(body.error,'Active company membership required');});
  it('denies revoked and inactive memberships even with a valid identity',async function(){for(const state of ['revoked','inactive']){let next=false,status;await api(async()=>({rows:[{id:'company',status:state}]})).requireCompany({cdUser:{uid:'member'}},{status:n=>{status=n;return{json:()=>{}};}},()=>next=true);assert.strictEqual(next,false);assert.strictEqual(status,403);}});
  it('selects only the verified active company, never a submitted owner UID',async function(){let args,next=false;const req={cdUser:{uid:'member'},body:{ownerUid:'another-owner'}};await api(async(sql,params)=>{args=params;return{rows:[{id:'allowed-company',legacy_owner_uid:'allowed-owner',status:'active',role:'field'}]};}).requireCompany(req,{},()=>next=true);assert.strictEqual(next,true);assert.strictEqual(req.cdCompany.id,'allowed-company');assert.deepStrictEqual(Array.from(args),['member']);});
  it('does not reveal a teammate personal notification to another teammate',async function(){const req={cdUser:{uid:'member'},cdCompany:{id:'company',role:'field'}};const out=await api(async(sql,params)=>{assert.ok(sql.includes('n.target_firebase_uid is null or n.target_firebase_uid=$2'));assert.deepStrictEqual(Array.from(params),['company','member']);return{rows:[]};}).supportDocs(req,'notifications');assert.strictEqual(out.length,0);});
});
