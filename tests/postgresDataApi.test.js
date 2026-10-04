const assert=require('assert');
const {cleanDoc}=require('../lib/dataApi');
const fs=require('fs');
const vm=require('vm');

describe('PostgreSQL compatibility data API',function(){
  it('returns the complete legacy payload with the Firestore id preserved',function(){
    const source={client:'Test',scopeItems:[{desc:'Demo'}],lineItems:[{desc:'Labor'}]};
    const out=cleanDoc({legacy_id:'abc123',legacy_payload:source});
    assert.deepStrictEqual(out,{client:'Test',scopeItems:[{desc:'Demo'}],lineItems:[{desc:'Labor'}],id:'abc123',ownerUid:'L5XUqfnWrrgbAk18X36XcHDJxnz1',userId:'L5XUqfnWrrgbAk18X36XcHDJxnz1'});
    assert.notStrictEqual(out,source);
  });
  it('handles a missing legacy payload safely',function(){
    assert.deepStrictEqual(cleanDoc({legacy_id:'x',legacy_payload:null}),{id:'x',ownerUid:'L5XUqfnWrrgbAk18X36XcHDJxnz1',userId:'L5XUqfnWrrgbAk18X36XcHDJxnz1'});
  });
  it('uses the owner UID for every list row rather than the array index',async function(){
    const rows=[0,1,2].map(i=>({legacy_id:'record-'+i,legacy_payload:{client:'Client '+i}}));
    const context={process:{env:{CD_OWNER_UID:'company-owner'}},module:{exports:{}},
      require:name=>name==='../db/postgres'?{getPool:()=>({query:async()=>({rows})})}:{}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../lib/dataApi'),'utf8'),context);
    const docs=await context.module.exports.listDocs('projects','company-id');
    assert.strictEqual(docs.length,3);
    docs.forEach(doc=>{assert.strictEqual(doc.ownerUid,'company-owner');assert.strictEqual(doc.userId,'company-owner');});
  });
});
