const assert=require('assert');
const {decodeValue,decodeDocument,digest}=require('../lib/legacySerialization');
describe('Firestore migration fidelity',function(){
  it('preserves empty arrays, empty maps, null, false and zero distinctly',function(){
    assert.deepStrictEqual(decodeValue({arrayValue:{}}),[]);
    assert.deepStrictEqual(decodeValue({mapValue:{}}),{});
    assert.strictEqual(decodeValue({nullValue:null}),null);
    assert.strictEqual(decodeValue({booleanValue:false}),false);
    assert.strictEqual(decodeValue({integerValue:'0'}),0);
  });
  it('compares nested source records without depending on object key order',function(){
    assert.strictEqual(digest({a:1,b:[{x:2,y:3}]}),digest({b:[{y:3,x:2}],a:1}));
    assert.notStrictEqual(digest({team:[]}),digest({team:null}));
    assert.notStrictEqual(digest({a:[1,2]}),digest({a:[2,1]}));
  });
  it('preserves document identity and nested signature/image fields',function(){
    const d=decodeDocument({name:'projects/test',fields:{team:{arrayValue:{}},signatureData:{stringValue:'data:image/png;base64,test'}}});
    assert.deepStrictEqual(d,{id:'test',team:[],signatureData:'data:image/png;base64,test'});
  });
});
