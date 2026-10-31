const {test,expect}=require('@playwright/test'),fs=require('fs'),path=require('path');
const F=require('../../public/financial-rules'),{applyRecordPatch}=require('../../lib/recordPatch');
const root=path.join(__dirname,'../../public');
function dataset(){return{projects:{qa:{id:'qa',client:'Bellevue QA',type:'Addition',jobNum:'JOB01122',address:'123 Bellevue Drive',pm:'QA Manager',poNum:'PO-TEST',userId:'cd_qa',ownerUid:'cd_qa',budget:10000,clientTotal:12500,spent:0,status:'Planning',scopeItems:[],choices:[],costs:[],changeOrders:[],paymentMilestones:[{id:'deposit',name:'Deposit',amount:5000,paid:false}],punchList:[],notesLog:[],dailyLogs:[]}},estimates:{},settings:{companyName:'QA Contractor',companyPhone:'4345550100',companyEmail:'qa@example.invalid',gettingStartedVersion:1,team:[],nextJobNum:2,nextEstNum:2},writes:0};}
async function fixture(page,data){
 await page.route('https://cd-qa.invalid/**',async route=>{
  const req=route.request(),u=new URL(req.url()),url=u.pathname;let out={},status=200;
  if(!url.startsWith('/api/')){const file=path.join(root,url==='/'?'index.html':url);return route.fulfill({status:200,body:fs.readFileSync(file),contentType:url.endsWith('.js')?'application/javascript':'text/html'});}
  const profile={id:'cd_qa',uid:'cd_qa',name:'QA Owner',email:'qa@example.invalid',plan:'paid',agreedToTerms:true};
  if(url==='/api/auth/session')out={user:profile};
  else if(url==='/api/data/session')out={session:{companyId:'company',workspaceOwnerUid:'cd_qa',role:'owner',status:'active'}};
  else if(url==='/api/data/identity/self')out={document:profile};
  else if(url==='/api/data/identity/invitation')out={document:null};
  else if(url.includes('/support/settings'))out={document:data.settings,documents:[{id:'cd_qa',...data.settings}]};
  else if(url.includes('/support/userProfiles'))out={document:profile,documents:[profile]};
  else if(url.includes('/support/'))out={documents:[],id:'notification',document:{}};
  else if(url==='/api/data/share'){const b=req.postDataJSON();out={query:'invoice='+b.id+'&ms='+b.scope.milestone+'&token=qa'};}
  else if(url.startsWith('/api/public/records/projects/')){out={document:data.projects[url.split('/').at(-1)]};}
  else if(url.match(/^\/api\/data\/(projects|estimates)/)){
    const [,kind,id]=url.match(/^\/api\/data\/(projects|estimates)(?:\/([^/]+))?/),store=data[kind];
    if(req.method()==='GET')out=id?{document:store[id]}:{documents:Object.values(store)};
    else{await new Promise(r=>setTimeout(r,100));data.writes++;const body=req.postDataJSON();try{const prior=store[id]||{};let doc=req.method()==='PATCH'?applyRecordPatch(prior,body.patch,body.expected):body;F.validate(kind,doc,prior);if(kind==='projects')F.reconcileApprovals(doc,prior);store[id]=JSON.parse(JSON.stringify(doc));out={document:store[id]};}catch(e){status=400;out={error:e.message};}}
  }else out={ok:true};
  return route.fulfill({status,json:{ok:status===200,...out}});
 });
 await page.goto('https://cd-qa.invalid/');await expect(page.locator('#cards')).toContainText('Bellevue QA');
}
for(const width of [390,1280]){
 test('financial workflow, repeated taps, and invoice navigation at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:844});const data=dataset();const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page,data);
  await page.locator('#searchInput').fill('JOB01122');await expect(page.locator('#cards .card')).toHaveCount(1);await page.locator('#searchInput').fill('Bellevue');await expect(page.locator('#cards .card')).toHaveCount(1);await page.locator('#cards .card').click();
  await page.getByRole('button',{name:'+ Add Scope Item',exact:false}).count().then(async n=>{if(n)await page.getByRole('button',{name:'+ Add Scope Item',exact:false}).click();else await page.evaluate(()=>showForm('scopeForm'));});
  await page.locator('#siSel').selectOption('__c__');await page.locator('#siCustom').fill('Demo');await page.locator('#siBud').fill('10000');await page.locator('#siAct').fill('1400');
  await page.evaluate(()=>{var b=document.querySelector('#scopeForm button[onclick="addScopeItem()"]');b.click();b.click();});
  await expect.poll(()=>data.projects.qa.scopeItems.length).toBe(1);await expect.poll(()=>data.projects.qa.spent).toBe(1400);expect(data.projects.qa.costs.length).toBe(1);await expect(page.locator('#tabBody')).toContainText('1,400');
  await page.evaluate(()=>{currentTab='payments';renderTabBody(gpr());});await expect(page.locator('#tabBody')).toContainText('12,500.00');await expect(page.locator('#tabBody')).toContainText('differs from the contract');
  await page.getByRole('button',{name:'Mark Paid'}).click();await expect(page.locator('#tabBody')).toContainText('PAID');expect(data.projects.qa.paymentMilestones[0].paid).toBe(true);
  await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.locator('#invoicePreviewDialog')).toBeVisible();await expect(page.frameLocator('#invoicePreviewDialog iframe').locator('#invoiceWrapper')).toContainText('$0.00');await page.getByRole('button',{name:'Back to project'}).click();await expect(page.locator('#invoicePreviewDialog')).toHaveCount(0);await expect(page.locator('#detailPage')).toHaveClass(/show/);
  await page.evaluate(()=>{currentTab='change-orders';renderTabBody(gpr());showForm('coForm');});await page.locator('#coTitle').fill('Extra work');await page.locator('#coBudget').fill('1500');await page.locator('#coStatus').selectOption('Approved');await page.locator('#coForm button[onclick="addCO()"]').click();await expect.poll(()=>data.projects.qa.clientTotal).toBe(14000);expect(data.projects.qa.budget).toBe(11500);expect(data.projects.qa.paymentMilestones.length).toBe(2);
  await page.reload();await page.locator('#cards .card').click();expect(await page.evaluate(()=>gpr().clientTotal)).toBe(14000);expect(await page.evaluate(()=>gpr().spent)).toBe(1400);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
test('required fields, invalid input, paid preview and support tools for ordinary owners',async({page})=>{
 const data=dataset();await fixture(page,data);await page.evaluate(()=>openAdd());await page.locator('#addPage button').filter({hasText:'Save'}).click();await expect(page.locator('#fClientError')).toContainText('required');await page.locator('#fClient').fill('New client');await page.locator('#fType').fill('Garage');await page.locator('#fClientEmail').fill('not-an-email');await page.locator('#addPage button').filter({hasText:'Save'}).click();await expect(page.locator('#fClientEmailError')).toContainText('valid email');expect(data.writes).toBe(0);
 await page.evaluate(()=>{closePage('addPage');openSettings();});await expect(page.locator('#settingsDiagnostics')).toBeHidden();await expect(page.locator('#adminCardPhase')).toBeHidden();await expect(page.locator('#adminCardTag')).toBeHidden();
});
test('estimate, explicit credit, project conversion, itemized invoice, and paid reload',async({page})=>{
 const data=dataset();await fixture(page,data);await page.evaluate(()=>openNewEstimate());await page.locator('#efClient').fill('Workflow QA');await page.locator('#efType').fill('Garage');await page.locator('#efProjectClass').selectOption('residential');await page.locator('#efTax').fill('5.3');await page.evaluate(()=>window.saveEstimate());await expect.poll(()=>Object.keys(data.estimates).length).toBe(1);const id=Object.keys(data.estimates)[0];await page.evaluate(id=>openEstDetail(id),id);
 await page.evaluate(()=>openAddLineItem());await page.locator('#liDesc').fill('Materials and installation labor');await page.locator('#liUnitCost').fill('-500');await page.locator('#liMarkup').fill('-200');await page.locator('#addLineItemModal button[onclick="saveLineItem()"]').click();await expect(page.locator('#liUnitCostError')).toContainText('at least 0');expect(data.estimates[id].lineItems.length).toBe(0);
 await page.locator('#liUnitCost').fill('1000');await page.locator('#liMarkup').fill('20');await page.locator('#addLineItemModal button[onclick="saveLineItem()"]').click();await expect.poll(()=>data.estimates[id].lineItems.length).toBe(1);await expect(page.locator('#addLineItemModal')).not.toHaveClass(/show/);
 await page.evaluate(()=>openAddLineItem());await page.locator('#liDesc').fill('Client credit');await page.locator('#liCredit').check();await page.locator('#liUnitCost').fill('-50');await page.locator('#liMarkup').fill('0');await page.locator('#addLineItemModal button[onclick="saveLineItem()"]').click();await expect.poll(()=>data.estimates[id].lineItems.length).toBe(2);await expect(page.locator('#addLineItemModal')).not.toHaveClass(/show/);expect(data.estimates[id].lineItems[1].isCredit).toBe(true);
 expect(await page.evaluate(()=>calcEstimate(ger()).grandTotal)).toBe(1210.95);expect(await page.evaluate(()=>getCanonicalCustomerScope(ger()).workIncluded.join(' '))).toContain('labor');
 page.on('dialog',d=>d.accept());await page.evaluate(()=>convertToProject());const projectId='project-from-'+id;await expect.poll(()=>!!data.projects[projectId]).toBe(true);await page.evaluate(id=>openDetail(id),projectId);expect(data.projects[projectId].budget).toBe(1000);expect(data.projects[projectId].clientTotal).toBe(1210.95);
 await page.evaluate(()=>{currentTab='payments';renderTabBody(gpr());openProjectInvoiceItems(-1);});await page.evaluate(()=>importProjectInvoiceEstimate());await expect(page.locator('#projectInvoiceTotal')).toContainText('1,210.95');await page.evaluate(()=>saveProjectInvoiceItems());await expect.poll(()=>data.projects[projectId].paymentMilestones.length).toBe(1);expect(data.projects[projectId].paymentMilestones[0].lineItems.length).toBe(3);
 await page.getByRole('button',{name:'Mark Paid'}).click();await expect.poll(()=>data.projects[projectId].paymentMilestones[0].paid).toBe(true);await page.reload();await expect(page.locator('#cards')).toContainText('Workflow QA');await page.evaluate(id=>openDetail(id),projectId);await page.evaluate(()=>{currentTab='payments';renderTabBody(gpr());});await expect(page.locator('#tabBody')).toContainText('PAID');expect(data.projects[projectId].spent).toBe(0);
});
