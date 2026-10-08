const assert=require('assert'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const a=html.indexOf('function forceLoadTeam('),b=html.indexOf('\nfunction ',a+1);
describe('team reload persistence',()=>{
 it('saves only restored team data and reports a failed save',async()=>{
  const el={style:{},textContent:''};let write;
  const context={DD:{companyName:'Stale company name'},currentId:null,document:{getElementById:()=>el},renderTeamList:()=>{},T:()=>{},sCol:{get:async()=>({forEach:fn=>fn({id:'dropdowns',data:()=>({team:[{name:'Fixture crew'}]})})}),doc:()=>({set:(data,options)=>{write={data,options};return Promise.reject(new Error('Fixture failure'));}})}};
  vm.runInNewContext(html.slice(a,b)+'\nforceLoadTeam();',context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(write)),{data:{team:[{name:'Fixture crew'}]},options:{merge:true}});
  assert.equal(el.textContent,'Team save failed: Fixture failure');
 });
});
