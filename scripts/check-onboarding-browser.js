/* Chromium checks of actual app markup/functions using synthetic state only.
 * No live identity provider, credentials, invitations, or company writes.
 */
async function run({chromium,assert,frontendSource}){
 const report={at:new Date().toISOString(),runtime:'Playwright 1.55.0 Chromium',fixtureOnly:true,liveSignup:false,checks:[]};
 function source(name){const a=frontendSource.indexOf('function '+name+'('),b=frontendSource.indexOf('\nfunction ',a+1);if(a<0)throw Error('Missing function '+name);return frontendSource.slice(a,b);}
 const names=['switchAuthTab','showAuthError','setAuthLoading','toggleSignupAgree','signUp','renderOnboarding','renderCards'];
 const scripts=names.map(source).join('\n');
 const markup=frontendSource.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const server=require('node:http').createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(markup);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'||url.protocol==='data:'?route.continue():route.abort();});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(s=>{
   window.providerCalls=0;window.auth={createUserWithEmailAndPassword:async()=>{providerCalls++;throw Error('Synthetic provider failure');}};
   window.normalizeInviteEmail=s=>String(s).trim().toLowerCase();
   window.DD={};window.CD_LOGO_FULL='';window.projects=[];window.activeFilter='All';window.projectWorkView='work';window.CD_USE_POSTGRES=true;window.estimatesSyncReady=true;window.inWorkView=()=>false;
   window.openSettings=()=>{window.settingsOpened=true;};window.openAdd=()=>{window.newProjectOpened=true;};window.renderAll=()=>renderCards();
   (0,eval)(s);document.getElementById('authScreen').style.display='block';
  },scripts);
  async function check(name,fn){try{await fn();report.checks.push({name,ok:true});}catch(e){report.checks.push({name,ok:false,error:String(e.message).slice(0,500)});}}
  await check('mobile signup tab exposes the actual name, company, email, password, and agreement controls',async()=>{await page.locator('#tabSignUp').click();for(const id of ['suName','suCompany','suEmail','suPassword','signupAgreeToggle'])assert(await page.locator('#'+id).isVisible());const box=await page.locator('#signUpForm').boundingBox();assert(box.width<=390);});
  await check('agreement gate and required-name validation stop identity-provider calls',async()=>{await page.locator('#signUpForm button').filter({hasText:'Start Free Trial'}).click();assert((await page.locator('#authError').innerText()).includes('must agree'));assert.strictEqual(await page.evaluate(()=>providerCalls),0);await page.locator('#signupAgreeToggle').click();await page.locator('#signUpForm button').filter({hasText:'Start Free Trial'}).click();assert((await page.locator('#authError').innerText()).includes('enter your name'));assert.strictEqual(await page.evaluate(()=>providerCalls),0);});
  await check('provider failure is visible and clears the loading state',async()=>{await page.locator('#suName').fill('Synthetic QA');await page.locator('#suCompany').fill('Synthetic QA Company');await page.locator('#suEmail').fill('synthetic@example.invalid');await page.locator('#suPassword').fill('synthetic-fixture-value');await page.locator('#signUpForm button').filter({hasText:'Start Free Trial'}).click();await page.locator('#authError').filter({hasText:'Synthetic provider failure'}).waitFor();assert.strictEqual(await page.locator('#authLoading').isVisible(),false);});
  await check('new-owner projects view renders the welcome checklist without stray text',async()=>{await page.evaluate(()=>{document.getElementById('authScreen').style.display='none';document.getElementById('mainView').style.display='block';window._sessionWorkspaceType='owner';localStorage.removeItem('onboardingDismissed');renderCards();});assert((await page.locator('#cards').innerText()).includes('Welcome to Contractor Desk'));assert.strictEqual(await page.locator('#cards').evaluate(el=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()),'');});
  await check('checklist actions open company setup and the first-project form',async()=>{await page.locator('#cards').getByText('Add your company name',{exact:true}).click();assert.strictEqual(await page.evaluate(()=>settingsOpened),true);await page.locator('#cards').getByText('Create your first project',{exact:true}).click();assert.strictEqual(await page.evaluate(()=>newProjectOpened),true);});
  await check('saved setup values render completed steps, and skipping retains the first-project action',async()=>{await page.evaluate(()=>{DD={companyName:'Synthetic QA Company',logoData:'data:image/svg+xml;base64,fixture',team:[{name:'Synthetic QA'}]};renderCards();});assert.strictEqual(await page.locator('#cards s').count(),4);await page.locator('#cards button').filter({hasText:'Skip setup'}).click();assert((await page.locator('#cards').innerText()).includes('Ready to go!'));assert.strictEqual(await page.locator('#cards button').filter({hasText:'Add First Project'}).isVisible(),true);});
  await check('invited teammates and empty filtered views never receive owner onboarding',async()=>{await page.evaluate(()=>{localStorage.removeItem('onboardingDismissed');window._sessionWorkspaceType='team';renderCards();});assert(!(await page.locator('#cards').innerText()).includes('Welcome'));await page.evaluate(()=>{window._sessionWorkspaceType='owner';document.getElementById('searchInput').value='missing project';renderCards();});assert(!(await page.locator('#cards').innerText()).includes('Welcome'));assert((await page.locator('#cards').innerText()).includes('No projects in this view'));});
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
 report.passed=report.checks.filter(c=>c.ok).length;report.failed=report.checks.filter(c=>!c.ok).length;report.ok=report.failed===0;return report;
}
module.exports={run};
