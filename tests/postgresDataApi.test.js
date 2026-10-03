const assert=require('assert');
const {cleanDoc}=require('../lib/dataApi');

describe('PostgreSQL compatibility data API',function(){
  it('returns the complete legacy payload with the Firestore id preserved',function(){
    const source={client:'Test',scopeItems:[{desc:'Demo'}],lineItems:[{desc:'Labor'}]};
    const out=cleanDoc({legacy_id:'abc123',legacy_payload:source});
    assert.deepStrictEqual(out,{client:'Test',scopeItems:[{desc:'Demo'}],lineItems:[{desc:'Labor'}],id:'abc123'});
    assert.notStrictEqual(out,source);
  });
  it('handles a missing legacy payload safely',function(){
    assert.deepStrictEqual(cleanDoc({legacy_id:'x',legacy_payload:null}),{id:'x'});
  });
});
