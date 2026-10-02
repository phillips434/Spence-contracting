const assert=require('assert'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);return html.slice(start,end);}
const c={};vm.createContext(c);['recordBelongsToWorkspace','companyBackupRecords'].forEach(n=>vm.runInContext(fn(n),c));
const snap=rows=>({forEach:cb=>rows.forEach(([id,data])=>cb({id,data:()=>data}))});
describe('company backup integrity',function(){
 it('excludes other companies and includes legacy team, archived and converted records',function(){const records=c.companyBackupRecords(snap([['owner-record',{userId:'owner',archived:true}],['office-record',{userId:'office',ownerUid:'office'}],['converted-estimate',{userId:'owner',converted:true}],['other',{userId:'outsider',ownerUid:'outsider'}]]),'owner','owner',['office']);assert.deepEqual(Array.from(records,r=>r.id),['owner-record','office-record','converted-estimate']);});
 it('retains document IDs and every nested selection, photo and price through JSON round trip',function(){const data={userId:'owner',choices:[{item:'Countertop',status:'Ordered'}],dailyLogs:[{photos:['data:image/png;base64,AAAA']}],lineItems:[{qty:2,unitCost:85,total:170}],notesLog:[{text:'Keep',photo:'data:image/png;base64,BBBB'}]};const exported=c.companyBackupRecords(snap([['original-id',data]]),'owner','owner',[]);const restored=JSON.parse(JSON.stringify(exported));assert.deepEqual(restored[0],{...data,id:'original-id'});});
 it('does not mutate source records',function(){const data={id:'old-id',userId:'owner'};assert.equal(c.companyBackupRecords(snap([['actual-id',data]]),'owner','owner',[])[0].id,'actual-id');assert.equal(data.id,'old-id');});
 it('requires the company owner, reads fresh settings, and keeps an explicit save link',function(){const code=fn('backupAllData');assert(code.includes('workspaceUid!==uid'));assert(code.includes('sCol.doc(workspaceSettingsDoc(workspaceUid)).get()'));assert(code.includes("link.textContent='Save backup file'"));assert(!code.includes('a.click()'));});
});
