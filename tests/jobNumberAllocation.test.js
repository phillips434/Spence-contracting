const assert=require('assert'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
const start=html.indexOf('async function nextJobNumber('),end=html.indexOf('\nfunction nextEstNumber',start);
function fixture(){
 let next=1,queue=Promise.resolve();
 const docs=[{ownerUid:'owner',jobNum:'JOB-0004'},{ownerUid:'owner',jobNum:'JOB-0048',archived:true},{ownerUid:'owner',jobNum:'2609'},{ownerUid:'owner',jobNum:'JOB-1788917321432'},{ownerUid:'other',jobNum:'JOB-9999'}];
 const c={currentUser:{uid:'owner'},DD:{nextJobNum:4},resolveWorkspaceUidForSession:async()=> 'owner',recordBelongsToWorkspace:r=>r.ownerUid==='owner',col:{get:async()=>({forEach:fn=>docs.forEach(data=>fn({data:()=>data}))})},sCol:{doc:id=>({id})},db:{collection:()=>({where:()=>({get:async()=>({forEach:()=>{}})})}),runTransaction:fn=>{const result=queue.then(()=>fn({get:async()=>({exists:true,data:()=>({nextNumber:next})}),set:(ref,data)=>{assert.equal(ref.id,'job-number-owner');next=data.nextNumber;}}));queue=result.catch(()=>{});return result;}},Promise,Math,Number,String,Error};
 vm.createContext(c);vm.runInContext(html.slice(start,end),c);return c;
}
describe('automatic company job numbers',()=>{
 it('recovers a stale counter using archived and manually numbered company jobs, excluding other companies and timestamp diagnostics',async()=>{assert.equal(await fixture().nextJobNumber(),'JOB-2610');});
 it('reserves distinct numbers for concurrent creators',async()=>{const c=fixture(),numbers=await Promise.all([c.nextJobNumber(),c.nextJobNumber()]);assert.deepEqual(numbers,['JOB-2610','JOB-2611']);});
 it('rejects a signed-out session instead of assigning a local number',async()=>{const c=fixture();c.currentUser=null;await assert.rejects(c.nextJobNumber(),/Sign in/);});
 it('propagates reservation failure without inventing a duplicate fallback',async()=>{const c=fixture();c.db.runTransaction=async()=>{throw Error('permission denied');};await assert.rejects(c.nextJobNumber(),/permission denied/);});
});
