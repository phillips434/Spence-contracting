// Opt-in HTTP verification against synthetic staging records only.
const assert=require('node:assert/strict');
const origin='https://cd-beta-candidate-staging.up.railway.app';
async function main(){
 if(!process.env.CD_QA_PASSWORD)throw Error('Synthetic staging password is required');
 let cookie='',passed=0;
 async function request(path,{method='GET',body,authenticated=true,requestOrigin=origin}={}){
  const headers={'Content-Type':'application/json',Origin:requestOrigin};if(authenticated&&cookie)headers.Cookie=cookie;
  const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 function check(name,fn){fn();passed++;console.log('PASS '+name);}
 const health=await request('/api/backend/health');check('isolated database health',()=>{assert.equal(health.status,200);assert.equal(health.body.database,'contractor_beta');});
 for(const path of ['/api/data/projects','/api/data/estimates','/api/estimate','/api/daily-log']){const r=await request(path,{method:path.startsWith('/api/data')?'GET':'POST',body:path.startsWith('/api/data')?undefined:{},authenticated:false});check('unsigned request denied '+path,()=>assert.equal(r.status,401));}
 const login=await request('/api/auth/login',{method:'POST',body:{email:'owner@contractor-beta.invalid',password:process.env.CD_QA_PASSWORD},authenticated:false});
 check('synthetic owner login and secure session cookie',()=>{assert.equal(login.status,200);assert.equal(login.body.user.uid,'cd_beta_fixture_owner');for(const flag of ['__Host-cd_session=','HttpOnly','Secure','SameSite=Lax'])assert(login.cookie.includes(flag));});cookie=login.cookie.split(';')[0];
 const snapshot=await request('/api/data/snapshot');check('synthetic workspace loads',()=>{assert.equal(snapshot.status,200);assert(snapshot.body.projects.some(p=>p.id==='beta-fixture-project'));assert(snapshot.body.estimates.some(p=>p.id==='beta-fixture-estimate'));assert(snapshot.body.projects.every(p=>p.ownerUid==='cd_beta_fixture_owner'));});
 const id='beta-smoke-'+Date.now(),p={id,client:'NONBINDING QA HTTP SAVE',ownerUid:'cd_beta_fixture_owner',userId:'cd_beta_fixture_owner',type:'Synthetic test',status:'In Progress',budget:5000,spent:100,choices:[{item:'Synthetic tile'}],costs:[{actualAmt:100}],dailyLogs:[],scopeItems:[{desc:'Synthetic work',complete:'Not Started'}],paymentMilestones:[{amount:500,paid:false}]};
 const create=await request('/api/data/projects/'+id,{method:'PUT',body:p});check('project create',()=>assert.equal(create.status,200));
 const save=await request('/api/data/projects/'+id,{method:'PATCH',body:{patch:{notes:'Office synthetic edit'},expected:{notes:{exists:false}}}});check('office field edit',()=>assert.equal(save.status,200));
 const field=await request('/api/data/projects/'+id,{method:'PATCH',body:{patch:{address:'Field synthetic edit'},expected:{address:{exists:false}}}});check('unrelated simultaneous field edit retained',()=>{assert.equal(field.status,200);assert.equal(field.body.document.notes,'Office synthetic edit');assert.deepEqual(field.body.document.choices,p.choices);});
 const stale=await request('/api/data/projects/'+id,{method:'PATCH',body:{patch:{notes:'Stale overwrite'},expected:{notes:{exists:false}}}});check('stale same-field save rejected',()=>assert.equal(stale.status,409));
 const read=await request('/api/data/projects/'+id);check('saved data reload and financial totals',()=>{assert.equal(read.body.document.notes,'Office synthetic edit');assert.equal(read.body.document.address,'Field synthetic edit');assert.equal(read.body.document.budget,5000);assert.equal(read.body.document.spent,100);assert.deepEqual(read.body.document.costs,p.costs);});
 const cross=await request('/api/data/projects/'+id,{method:'PATCH',requestOrigin:'https://untrusted.invalid',body:{patch:{notes:'Denied'}}});check('cross-origin write denied',()=>assert.equal(cross.status,403));
 const share=await request('/api/data/share',{method:'POST',body:{mode:'sub',id,scope:{scope:0}}});check('scoped subcontractor link creation',()=>assert.equal(share.status,200));
 const params=new URLSearchParams(share.body.query);const q=new URLSearchParams({mode:'sub',root:id,token:params.get('token'),scope:'99'});
 const portal=await request('/api/public/records/projects/'+id+'?'+q,{authenticated:false});check('public link uses stored scope and omits internal financials',()=>{assert.equal(portal.status,200);assert.equal(portal.body.document.scopeItems[0].desc,'Synthetic work');assert.equal(portal.body.document.budget,undefined);assert.equal(portal.body.document.costs,undefined);});
 const log=await request('/api/public/actions/projects/'+id+'?'+q,{method:'POST',authenticated:false,body:{action:'sub-log',index:0,entry:{work:'NONBINDING QA DAILY LOG',issues:'None',photos:['data:image/png;base64,YQ==']}}});check('subcontractor daily log persists',()=>{assert.equal(log.status,200);assert.equal(log.body.document.dailyLogs[0].work,'NONBINDING QA DAILY LOG');});
 const scope=await request('/api/public/actions/projects/'+id+'?'+q,{method:'POST',authenticated:false,body:{action:'sub-status',index:1,status:'Complete'}});check('unassigned scope action denied',()=>assert.equal(scope.status,409));
 await request('/api/data/share/revoke',{method:'POST',body:{token:params.get('token')}});
 const revoked=await request('/api/public/records/projects/'+id+'?'+q,{authenticated:false});check('revoked link denied',()=>assert.equal(revoked.status,403));
 const signup=await request('/api/auth/signup',{method:'POST',body:{}});check('signup blocked until email configured',()=>assert.equal(signup.status,503));
 const eid=id+'-estimate',estimate={id:eid,client:'NONBINDING QA ESTIMATE',type:'Synthetic kitchen',projectClass:'residential',ownerUid:p.ownerUid,userId:p.userId,status:'Draft',customerScope:{residentialSummary:'Synthetic summary',projectScope:'Synthetic scope',workIncluded:['Synthetic material'],conditionsAssumptions:['Synthetic condition']},lineItems:[{qty:10,unitCost:50,total:500,markup:20,desc:'Synthetic material'}],contractText:'NONBINDING AUTOMATED FIXTURE. No offer, contract, or payment obligation.'};
 const ec=await request('/api/data/estimates/'+eid,{method:'PUT',body:estimate});check('estimate with prices creates',()=>assert.equal(ec.status,200));
 const edit=await request('/api/data/estimates/'+eid,{method:'PATCH',body:{patch:{'customerScope.residentialSummary':'Edited summary'},expected:{'customerScope.residentialSummary':{exists:true,value:'Synthetic summary'}}}});check('summary edit preserves scope and pricing',()=>{assert.equal(edit.status,200);assert.equal(edit.body.document.customerScope.projectScope,'Synthetic scope');assert.deepEqual(edit.body.document.lineItems,estimate.lineItems);});
 const es=await request('/api/data/share',{method:'POST',body:{mode:'est',id:eid,scope:{}}});check('estimate link creation',()=>assert.equal(es.status,200));
 const ep=new URLSearchParams(es.body.query),eq=new URLSearchParams({mode:'est',root:eid,token:ep.get('token')});
 const signature='data:image/png;base64,YQ==',sign=await request('/api/public/actions/estimates/'+eid+'?'+eq,{method:'POST',authenticated:false,body:{action:'estimate-sign',name:'NONBINDING QA CLIENT',signature}});check('nonbinding fixture signing preserves prices',()=>{assert.equal(sign.status,200);assert.equal(sign.body.document.status,'Approved');assert.deepEqual(sign.body.document.lineItems,estimate.lineItems);});
 const again=await request('/api/public/actions/estimates/'+eid+'?'+eq,{method:'POST',authenticated:false,body:{action:'estimate-sign',name:'NONBINDING QA CLIENT',signature}});check('duplicate signing rejected',()=>assert.equal(again.status,409));
 const er=await request('/api/data/estimates/'+eid);check('signed estimate reload',()=>{assert.equal(er.body.document.customerScope.residentialSummary,'Edited summary');assert.equal(er.body.document.customerScope.projectScope,'Synthetic scope');assert.equal(er.body.document.signatureData,signature);});
 if(process.env.CD_QA_PORTAL_OUTPUT)require('node:fs').writeFileSync(process.env.CD_QA_PORTAL_OUTPUT,JSON.stringify({estimate:origin+'/?'+es.body.query}));
 await request('/api/auth/logout',{method:'POST',body:{}});const ended=await request('/api/data/projects');check('logout invalidates server session',()=>assert.equal(ended.status,401));
 console.log(passed+' live staging checks passed. Synthetic fixture retained for review.');
}
main().catch(e=>{console.error('Staging smoke failed:',e.message);process.exitCode=1;});
