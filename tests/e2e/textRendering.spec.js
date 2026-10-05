const {test,expect}=require('@playwright/test');
const fs=require('fs');
const html=fs.readFileSync(require.resolve('../../public/index.html'),'utf8');
function source(name){const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);return html.slice(a,b);}
const payload='<img src=x onerror="window.injected=true">';
test('customer narratives and team contacts render markup as literal text on phone and desktop',async({page})=>{
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:844});
  await page.setContent('<main id="narrative"></main><div id="teamList"></div>');
  await page.evaluate(({source,payload})=>{
   window.DD={team:[{name:payload,email:payload,trade:payload,phone:payload}]};
   window.getCanonicalCustomerScope=()=>({projectScope:payload,workIncluded:[payload],conditionsAssumptions:[payload],exclusions:[payload]});
   (0,eval)(source);
   document.getElementById('narrative').innerHTML=renderCommercialNarrativeBlock({},true);
   renderTeamList();
  },{source:['escapeHtmlText','renderCommercialNarrativeBlock','renderTeamList'].map(source).join('\n'),payload});
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('#narrative')).toContainText(payload);
  await expect(page.locator('#teamList')).toContainText(payload);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
 }
});

test('subcontractor portals and invoices keep saved markup inert',async({page})=>{
 for(const width of [390,1280])for(const query of ['sub=test&scope=0','sub=test&scopes=0','invoice=test&ms=0']){
  await page.setViewportSize({width,height:844});
  await page.route('https://fixture.invalid/**',route=>route.fulfill({body:'<div id="mainView"></div>',contentType:'text/html'}));
  await page.goto('https://fixture.invalid/?'+query);
  await page.evaluate(({source,payload,query})=>{
   window.DD={};window.LOGO_SRC='';window.CD_LOGO='';
   window.rememberProjectSnapshot=x=>x;window.fmt=x=>x;
   const p={client:payload,type:payload,address:payload,clientEmail:payload,companyName:payload,companyPhone:payload,companyEmail:payload,companyAddress:payload,companyPaymentInstructions:payload,id:'test',logoData:'x" onerror="window.injected=true',scopeItems:[{desc:payload,category:payload,complete:payload,status:payload,actual:100}],dailyLogs:[{subScopeIdx:0,date:payload,weather:payload,work:payload,issues:payload,photos:['x" onerror="window.injected=true']}],paymentMilestones:[{name:payload,amount:100,pct:payload}]};
   const doc={exists:true,data:()=>p};window.col={doc:()=>({get:()=>Promise.resolve(doc),onSnapshot:cb=>cb(doc)})};
   (0,eval)(source);query.startsWith('invoice')?checkInvoiceView():checkSubView();
  },{source:['escapeHtmlText','moneyAmount','checkSubView','checkInvoiceView'].map(source).join('\n'),payload,query});
  const wrapper=page.locator(query.startsWith('invoice')?'#invoiceWrapper':'#subWrapper');
  await expect(wrapper).toContainText(payload);
  await expect(wrapper.locator('[onerror]')).toHaveCount(0);
  await expect(wrapper.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
 }
});
