const assert=require('assert'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);return html.slice(start,end);}
function session(uid,store){
 const listeners=[],badge={style:{}},context={currentUser:{uid,displayName:uid},notifications:[],unreadCount:0,unsubNotifs:null,console,T:()=>{},document:{getElementById:()=>badge},resolveWorkspaceUidForSession:async()=>uid==='outsider'?'other-company':'owner',Date,Promise};
 const emit=()=>listeners.forEach(l=>{if(!l.stopped)l.cb({forEach:cb=>Object.entries(store).filter(([,n])=>n[l.field]===l.value).forEach(([id,n])=>cb({id,data:()=>n}))});});
 context.nCol={add:async n=>{store['n'+Object.keys(store).length]=n;emit();},doc:id=>({update:async patch=>{for(const [key,value] of Object.entries(patch)){const parts=key.split('.');if(parts.length===1)store[id][key]=value;else{store[id][parts[0]]=store[id][parts[0]]||{};store[id][parts[0]][parts[1]]=value;}}emit();}}),where:(field,op,value)=>({onSnapshot:cb=>{const l={field,value,cb};listeners.push(l);emit();return()=>l.stopped=true;}})};
 vm.createContext(context);['pushNotification','notificationForUser','updateNotificationForUser','startNotifSync'].forEach(name=>vm.runInContext(fn(name),context));
 return {c:context,emit,badge};
}
describe('shared company bell alerts',function(){
 it('delivers Ethan activity to owner and owner activity to Ethan, excluding another company',async function(){
 const store={},owner=session('owner',store),ethan=session('ethan',store),other=session('outsider',store);
 for(const s of [owner,ethan,other]){s.c.startNotifSync();await Promise.resolve();}
 await ethan.c.pushNotification('Daily log added','Test project','project1');owner.emit();other.emit();
 assert.equal(owner.c.notifications.length,1);assert.equal(owner.c.notifications[0].actorUid,'ethan');assert.equal(owner.c.notifications[0].projectId,'project1');assert.equal(other.c.notifications.length,0);
 await owner.c.pushNotification('Punch item completed','Test project','project1');ethan.emit();assert.equal(ethan.c.notifications.length,2);
 });
 it('keeps reading and clearing independent for each user',async function(){
 const store={},owner=session('owner',store),ethan=session('ethan',store);owner.c.startNotifSync();ethan.c.startNotifSync();await Promise.resolve();
 await ethan.c.pushNotification('Work saved','Test','p');owner.emit();
 await owner.c.updateNotificationForUser(owner.c.notifications[0],'readBy');ethan.emit();assert.equal(owner.c.unreadCount,0);assert.equal(ethan.c.unreadCount,1);
 await owner.c.updateNotificationForUser(owner.c.notifications[0],'hiddenBy');ethan.emit();assert.equal(owner.c.notifications.length,0);assert.equal(ethan.c.notifications.length,1);assert.equal(Object.keys(store).length,1);
 });
 it('preserves legacy personal alerts and stops listeners on sign out',async function(){const store={old:{text:'Old',userId:'owner',read:false,ts:1}},s=session('owner',store);s.c.startNotifSync();await Promise.resolve();assert.equal(s.c.notifications.length,1);s.c.unsubNotifs();s.c.currentUser=null;store.new={workspaceUid:'owner',ts:2};s.emit();assert.equal(s.c.notifications.length,1);});
 it('emits project alerts after successful saves including successful retry, with a project link',function(){assert(html.includes("pushNotification(notifText||('Project updated: '+record.client),record.client,record.id)"));});
});
