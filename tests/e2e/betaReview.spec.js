const {test,expect}=require('@playwright/test');
const fs=require('fs');
const html=fs.readFileSync(require.resolve('../../public/index.html'),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
const viewport=html.match(/<meta name="viewport"[^>]+>/)[0];
function source(name){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);if(start<0||end<start)throw Error(name);return html.slice(start,end);}
const financial=['rememberRecordSnapshot','escapeHtmlText','calcLineItemTotal','calcEstimate','milestonePaid','moneyAmount','estimateScheduleState','scheduleWarning','reconcileEstimateSchedule'];
for(const width of [390,1280]){
 test('payment mismatch review and safe reconciliation at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.setContent(viewport+'<style>'+css+'</style><main id="estDetailBody"></main>');
  await page.evaluate(code=>{
   window.currentEstId='qa';window.DD={};window.EST_SC={};window.document.body.classList.remove('client-mode');
   window.record={id:'qa',client:'QA review',type:'Test',status:'Draft',lineItems:[{desc:'Original work',qty:1,unit:'ea',total:11817.96,markup:20},{desc:'Two cleanup hours',qty:2,unit:'hrs',unitCost:85,total:170,markup:20}],paymentMilestones:[{name:'Paid deposit',amount:4254,paid:true,paidAt:1},{name:'Custom progress',amount:5673},{name:'Final',amount:4254.55}]};
   window.ger=()=>record;window.eCol={doc:()=>({set:async value=>{window.saved=JSON.parse(JSON.stringify(value));}})};
   window.fmt=()=>'';window.fmtTS=()=>'';window.T=()=>{};window.generateContractText=()=>'';window.renderResidentialNarrativeBlock=()=>'';window.archiveControls=()=>'';
   window.confirm=()=>true;
   (0,eval)(code);renderEstDetailBody(record);
  },[...financial,'renderEstDetailBody'].map(source).join('\n'));
  await expect(page.getByRole('alert')).toContainText('Short by $204.00');
  await expect(page.locator('#estDetailBody')).toContainText('$14,385.55');
  await page.getByRole('button',{name:'Adjust final unpaid milestone'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#estDetailBody')).toContainText('$4,458.55');
  expect(await page.evaluate(()=>saved.paymentMilestones[0].paidAt)).toBe(1);
  expect(await page.evaluate(()=>saved.paymentMilestones[1].amount)).toBe(5673);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const del=page.getByRole('button',{name:'Delete payment milestone'}).first();
  const rect=await del.boundingBox();expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.height).toBeGreaterThanOrEqual(44);
 });
 test('Settings groups preserve fields, labels and maintenance controls at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:844});
  const start=html.indexOf('<div class="fpage" id="settingsPage">'),end=html.indexOf('<script>',start);
  await page.setContent(viewport+'<style>'+css+'</style>'+html.slice(start,end));
  await page.evaluate(code=>{window.accessibleFieldCounter=0;(0,eval)(code);organizeSettings();document.getElementById('settingsPage').classList.add('show');enhanceAccessibility(document);},['organizeSettings','enhanceAccessibility'].map(source).join('\n'));
  await expect(page.getByLabel('Company Name',{exact:true})).toBeVisible();
  await page.getByLabel('Company Name',{exact:true}).fill('QA Company');
  expect(await page.locator('#settingsMaintenanceGroup #adminCardPhase').count()).toBe(1);
  await expect(page.getByRole('button',{name:'Restore All Phase Data'})).toBeHidden();
  await page.locator('#settingsAccessGroup>summary').click();
  await expect(page.locator('#settingsAccessGroup').getByText(/Account Access/)).toBeVisible();
  await expect(page.getByText('Crew Contact Directory — Subs & Employees',{exact:true})).toBeVisible();
  await page.getByLabel('Invite by Email').fill('qa@example.invalid');
  await page.locator('#settingsCompanyGroup>summary').click();await page.locator('#settingsCompanyGroup>summary').click();
  await expect(page.getByLabel('Company Name',{exact:true})).toHaveValue('QA Company');
  expect(await page.evaluate(()=>document.querySelector('meta[name=viewport]').content.includes('user-scalable=no'))).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/cd-settings-'+width+'.png'});
 });
 test('client preview includes customer work and cents without private costs at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:844});await page.setContent('<style>'+css+'</style><main id="portalBody"></main>');
  await page.evaluate(code=>{
   window.projects=[];window.DD={companyName:'QA'};window.CD_LOGO_FULL='';window.EST_SC={Draft:'#888'};window.fmt=()=>'';
   window.resolveEstimateProjectClass=()=> 'residential';window.renderResidentialNarrativeBlock=()=>'<div>Customer scope</div>';window.renderCommercialNarrativeBlock=()=>'';window.getCanonicalCustomerScope=()=>({projectScope:'Customer scope'});
   (0,eval)(code);renderPortalBody({id:'qa',client:'QA',status:'Draft',lineItems:[{desc:'Work <literal>',qty:2,unit:'hrs',total:170,markup:20}],exclusions:['Permit <literal>'],paymentMilestones:[{name:'Payment',amount:204}]});
  },[...financial,'renderPortalBody'].map(source).join('\n'));
  await expect(page.locator('#portalBody')).toContainText('Work <literal>');await expect(page.locator('#portalBody')).toContainText('$204.00');
  await expect(page.locator('#portalBody')).not.toContainText('$170.00');await expect(page.locator('#portalBody')).not.toContainText('markup');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
test('main navigation resets scrolling and missing deadlines are not overdue',async({page})=>{
 await page.setContent('<div style="height:3000px"></div>'+['navProjects','navEstimates','navDashboard','projectsView','estimatesView','dashboardView','btnNew','cards','searchInput'].map(id=>'<div id="'+id+'"></div>').join(''));
 await page.evaluate(code=>{
  window.projects=[{id:'qa',status:'Planning',client:'QA',type:'Test',endDate:''}];window.activeFilter='All';window.projectWorkView='work';window.CD_USE_POSTGRES=true;window.estimatesSyncReady=true;window.closePage=()=>{};window.openAdd=()=>{};window.sc=()=>null;window.gp=()=>0;window.daysLeft=()=>NaN;window.fmt=()=>'';window.inWorkView=()=>true;document.getElementById('searchInput').value='';
  (0,eval)(code);window.scrollTo(0,1000);switchMainTab('projects');
 },['escapeHtmlText','renderCards','switchMainTab'].map(source).join('\n'));
 expect(await page.evaluate(()=>scrollY)).toBe(0);await expect(page.locator('#cards')).toContainText('No end date');await expect(page.locator('#cards')).not.toContainText('Overdue');
});
test('phone project section picker exposes every section without a crowded tab row',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.setContent('<style>'+css+'</style><div id="detailPage"><div class="project-section-select"><label for="projectSectionSelect">Project section</label><select id="projectSectionSelect" onchange="changeProjectSection(this.value)"></select></div><div class="ptabs" id="tabs"></div><main id="tabBody"></main></div>');
 await page.evaluate(code=>{window.currentTab='scope';window.gpr=()=>({id:'qa'});window.renderTabBody=()=>document.getElementById('tabBody').textContent=currentTab;(0,eval)(code);renderTabs(gpr());},['changeProjectSection','renderTabs'].map(source).join('\n'));
 await expect(page.locator('#tabs')).toBeHidden();expect(await page.locator('#projectSectionSelect option').count()).toBe(10);
 await page.getByLabel('Project section').selectOption('payments');await expect(page.locator('#tabBody')).toHaveText('payments');
});

for(const width of [390,1280])test('customer project header uses its company brand, never the app fallback at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:844});await page.setContent('<style>'+css+'</style><main id="brandPortal"></main>');
 await page.evaluate(code=>{
  window.DD={companyName:'Another signed-in company',logoData:'data:image/png;base64,WRONG'};
  window.CD_LOGO='data:image/png;base64,APPFOOTER';window.CD_LOGO_FULL='data:image/png;base64,APPHEADER';window.initSigCanvas=()=>{};window.fmt=()=>'';window.fmtDate=()=>'';
  (0,eval)(code);
  window.brandProject={id:'qa',companyName:'Spence Construction',client:'QA Client',type:'QA',logoData:'data:image/png;base64,YQ==',scopeItems:[],changeOrders:[]};
  renderProjectPortal(brandProject,null,document.getElementById('brandPortal'));
 },['escapeHtmlText','renderProjectPortal'].map(source).join('\n'));
 await expect(page.locator('.client-header')).toContainText('Spence Construction');
 await expect(page.locator('.client-header img')).toHaveAttribute('src','data:image/png;base64,YQ==');
 await page.evaluate(()=>{delete brandProject.logoData;renderProjectPortal(brandProject,null,document.getElementById('brandPortal'));});
 await expect(page.locator('.client-header')).toContainText('Spence Construction');await expect(page.locator('.client-header img')).toHaveCount(0);
});
