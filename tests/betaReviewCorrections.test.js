const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const server=require('../lib/estimatePaymentSafety');
function source(name){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);assert(start>=0&&end>start,name);return html.slice(start,end);}
function load(names,extras={}){const c={...extras};vm.createContext(c);vm.runInContext(names.map(source).join('\n'),c);return c;}
const base=['rememberRecordSnapshot','calcLineItemTotal','calcEstimate','milestonePaid','moneyAmount','estimateScheduleState'];
const estimate=()=>({id:'qa',lineItems:[{total:11817.96,markup:20}],paymentMilestones:[{name:'Deposit',amount:4254,paid:true,paidAt:1},{name:'Progress',amount:5673,dueDate:'2026-12-01'},{name:'Final',amount:4254.55}]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
describe('beta review financial regressions',()=>{
 it('detects the live $204 mismatch after an AI-priced addition and agrees with the server',()=>{
  const c=load(base),e=estimate();assert.equal(c.estimateScheduleState(e).mismatch,false);
  e.lineItems.push({qty:2,unitCost:85,total:170,markup:20});
  assert.equal(c.estimateScheduleState(e).difference,204);
  assert.deepEqual(JSON.parse(JSON.stringify(c.estimateScheduleState(e))),server.estimateScheduleState(e));
 });
 it('preserves paid/custom rows and due dates while reconciling only the final unpaid amount',async()=>{
  const e=estimate();e.lineItems.push({total:170,markup:20});let saved;
  Object.defineProperty(e,'_savedRecordSnapshot',{value:JSON.parse(JSON.stringify(e)),writable:true,configurable:true});
  const c=load([...base,'reconcileEstimateSchedule'],{ger:()=>e,confirm:()=>true,alert:()=>assert.fail('unexpected alert'),eCol:{doc:()=>({set:async record=>{saved=record;}})},renderEstDetailBody(){},T(){}});
  c.reconcileEstimateSchedule();await flush();assert.equal(e.paymentMilestones[2].amount,4458.55);
  assert.equal(e.paymentMilestones[0].amount,4254);assert.equal(e.paymentMilestones[0].paidAt,1);
  assert.equal(e.paymentMilestones[1].dueDate,'2026-12-01');assert.equal(saved._savedRecordSnapshot.id,'qa');
  assert.equal(c.estimateScheduleState(e).mismatch,false);assert.equal(e._savedRecordSnapshot.paymentMilestones[2].amount,4458.55);
 });
 it('does not change a schedule if saving fails or the user cancels',async()=>{
  for(const cancel of [false,true]){const e=estimate();e.lineItems.push({total:170,markup:20});const before=JSON.stringify(e);let writes=0;
   const c=load([...base,'reconcileEstimateSchedule'],{ger:()=>e,confirm:()=>!cancel,alert(){},eCol:{doc:()=>({set:async()=>{writes++;throw Error('conflict');}})},T(){},renderEstDetailBody(){assert.fail('failed save rendered');}});
   c.reconcileEstimateSchedule();await flush();assert.equal(JSON.stringify(e),before);assert.equal(writes,cancel?0:1);
  }
 });
 it('refuses fully paid, invalid, or negative adjustments and does not regenerate paid schedules',()=>{
  const cases=[{lineItems:[{total:100}],paymentMilestones:[{amount:50,paid:true}]},{lineItems:[{total:100}],paymentMilestones:[{amount:'invalid'}]},{lineItems:[{total:50}],paymentMilestones:[{amount:90,paid:true},{amount:10}]}];
  for(const e of cases){let writes=0,alerts=0;const c=load([...base,'reconcileEstimateSchedule'],{ger:()=>e,alert:()=>alerts++,eCol:{doc:()=>({set:()=>writes++})}});c.reconcileEstimateSchedule();assert.equal(writes,0);assert.equal(alerts,1);}
  let alerts=0;const c=load([...base,'autoGenMilestones'],{ger:()=>cases[0],alert:()=>alerts++});c.autoGenMilestones();assert.equal(alerts,1);
 });
 it('blocks sharing and sending mismatched schedules before token creation or draft opening',()=>{
  for(const action of ['shareEstimate','sendEstimate']){const e=estimate();e.lineItems.push({total:170});let alerts=0;
   const c=load([...base,'ensureEstimateSchedule',action],{ger:()=>e,alert:()=>alerts++,document:{getElementById:()=>null},CD_USE_POSTGRES:true,prepareSharedLink:()=>assert.fail('token created'),window:{open:()=>assert.fail('draft opened')}});c[action]();assert.equal(alerts,1);
  }
 });
 it('keeps cents consistent and treats empty schedules as optional',()=>{
  const c=load(base);assert.equal(c.moneyAmount(14385.55),'14,385.55');assert.equal(c.estimateScheduleState({lineItems:[{total:100}],paymentMilestones:[]}).mismatch,false);
  assert.equal(c.estimateScheduleState({lineItems:[{total:100.01}],paymentMilestones:[{amount:30},{amount:40},{amount:30.01}]}).mismatch,false);
 });
 it('counts only open unsigned unexpired estimates including drafts prepared for review',()=>{
  const c=load(['isOpenEstimate']),today='2026-10-05';
  for(const status of ['Draft','Sent to Client','Ready for Client Review','Approved'])assert.equal(c.isOpenEstimate({status},today),true);
  for(const status of ['Declined','Rejected','Expired','Converted'])assert.equal(c.isOpenEstimate({status},today),false);
  assert.equal(c.isOpenEstimate({status:'Approved',signedAt:1},today),false);
  assert.equal(c.isOpenEstimate({status:'Draft',validUntil:'2026-10-04'},today),false);
  assert.equal(c.isOpenEstimate({status:'Draft',converted:true},today),false);
 });
 it('preserves a zero percent markup when editing or using company defaults',()=>{
  const nodes={};const c=load(['openEditEstimate','openNewEstimate','openAddLineItem'],{DD:{aiProfile:{markup:0}},ger:()=>({id:'qa',markup:0}),document:{getElementById:id=>nodes[id]||(nodes[id]={value:'',classList:{add(){}}})}});
  c.openEditEstimate();assert.equal(nodes.efMarkup.value,0);c.openNewEstimate();assert.equal(nodes.efMarkup.value,0);c.openAddLineItem();assert.equal(nodes.liMarkup.value,0);assert.equal(nodes.liMarkupS.value,0);
 });
 it('does not mark change orders sent or create tokens without contact details',()=>{
  const p={id:'qa',changeOrders:[{title:'QA',status:'Pending'}]},before=JSON.stringify(p);let notices=0;
  const c=load(['sendCOToClient'],{gpr:()=>p,T:()=>notices++,CD_USE_POSTGRES:true,prepareSharedLink:()=>assert.fail('token created'),saveP:()=>assert.fail('saved')});c.sendCOToClient(0);assert.equal(JSON.stringify(p),before);assert.equal(notices,1);
 });
 it('preparing a change order draft permits review without claiming delivery',()=>{
  const p={id:'qa',client:'QA',clientEmail:'qa@example.invalid',changeOrders:[{title:'QA',status:'Pending',budgetImpact:25}]};let activity='';
  const c=load(['sendCOToClient'],{gpr:()=>p,window:{location:{href:'https://fixture.invalid/'}},DD:{},saveP:(_p,text)=>activity=text});c.sendCOToClient(0);
  assert.equal(p.changeOrders[0].status,'Ready for Client Review');assert.equal(p.changeOrders[0].sentAt,undefined);assert.equal(p.changeOrders[0].deliveryState,'draft-opened');assert.match(activity,/delivery not confirmed/);
 });
 it('renders the corrected pipeline and overdue payment alert from canonical payment records',()=>{
  const node={innerHTML:''};const c=load([...base,'compactMoney','isOpenEstimate','renderDashboard'],{projects:[{status:'Planning',paymentMilestones:[{amount:100,dueDate:'2000-01-01'},{amount:100,dueDate:'2000-01-01',isPaid:true}]}],estimates:[{status:'Draft',lineItems:[{total:1000}]},{status:'Declined',lineItems:[{total:2000}]},{status:'Expired',lineItems:[{total:3000}]},{status:'Approved',signedAt:1,lineItems:[{total:4000}]}],inWorkView:()=>true,document:{getElementById:()=>node}});
  c.renderDashboard();assert.match(node.innerHTML,/\$1K/);assert.match(node.innerHTML,/1 pending/);assert.match(node.innerHTML,/1 payment milestone overdue/);assert(!node.innerHTML.includes('$10K'));
 });
});
