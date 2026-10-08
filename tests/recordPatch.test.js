const assert=require('assert');
const {applyRecordPatch}=require('../lib/recordPatch');
describe('record save conflict protection',()=>{
 it('preserves fields outside an edit and supports dotted scope fields',()=>{const record={notes:'Office update',customerScope:{projectScope:'Original',workIncluded:['Retain']}};const next=applyRecordPatch(record,{'customerScope.projectScope':'New'},{'customerScope.projectScope':{exists:true,value:'Original'}});assert.equal(next.notes,'Office update');assert.deepEqual(next.customerScope.workIncluded,['Retain']);assert.equal(record.customerScope.projectScope,'Original');});
 it('rejects stale edits but permits an already-applied value',()=>{const current={choices:['New']},expected={choices:{exists:true,value:['Old']}};assert.throws(()=>applyRecordPatch(current,{choices:['Different']},expected),/Another person changed choices/);assert.deepEqual(applyRecordPatch(current,{choices:['New']},expected),current);});
 it('detects a competing edit to a previously missing field',()=>{assert.throws(()=>applyRecordPatch({notes:'New'},{notes:'Stale'},{notes:{exists:false}}),/Another person changed notes/);});
 it('rejects prototype-mutating paths',()=>{for(const key of ['__proto__.polluted','constructor.prototype.polluted','scope.prototype.value'])assert.throws(()=>applyRecordPatch({},JSON.parse(JSON.stringify({[key]:true}))),/Invalid field path/);assert.equal({}.polluted,undefined);});
});
