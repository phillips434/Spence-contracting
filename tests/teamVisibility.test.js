const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
describe('company record visibility',function(){
  const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
  const start=html.indexOf('function recordBelongsToWorkspace(');
  const end=html.indexOf('\nfunction ',start+1);
  const context={};vm.runInNewContext(html.slice(start,end),context);
  const visible=context.recordBelongsToWorkspace;
  it('includes legacy estimates owned by verified company teammates',function(){assert.strictEqual(visible({userId:'heather'},'owner','owner',['heather']),true);});
  it('includes explicit company metadata',function(){assert.strictEqual(visible({userId:'heather',ownerUid:'owner'},'owner','owner',[]),true);});
  it('includes the observed legacy personal-owner format for company teammates',function(){assert.strictEqual(visible({userId:'heather',ownerUid:'heather'},'owner','owner',['heather']),true);assert.strictEqual(visible({userId:'other',ownerUid:'other'},'owner','owner',['heather']),false);});
  it('excludes unrelated accounts and conflicting company metadata',function(){assert.strictEqual(visible({userId:'other'},'owner','owner',['heather']),false);assert.strictEqual(visible({userId:'heather',ownerUid:'other'},'owner','owner',['heather']),false);});
  it('preserves owner and member access to company records',function(){assert.strictEqual(visible({userId:'owner'},'heather','owner',['heather']),true);assert.strictEqual(visible({userId:'owner'},'owner','owner',[]),true);});
});
