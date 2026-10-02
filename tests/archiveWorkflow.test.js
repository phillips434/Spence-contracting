const assert=require('assert');
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
function source(name){const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);assert(a>=0&&b>a);return html.slice(a,b);}
function load(c,names){vm.createContext(c);names.forEach(n=>vm.runInContext(source(n),c));return c;}
describe('daily work and archive views',()=>{
  const c=load({},['isTestRecord','inWorkView']);
  it('keeps completed and declined real work visible until manually archived',()=>{
    assert(c.inWorkView({client:'Customer',status:'Completed'},'work'));
    assert(c.inWorkView({client:'Customer',status:'Declined'},'work'));
  });
  it('separates legacy QA, archives, and real work while all records remains complete',()=>{
    const qa={client:'QA Photo Test'},archived={client:'Customer',archived:true},real={client:'Customer'};
    assert(!c.inWorkView(qa,'work'));assert(c.inWorkView(qa,'tests'));
    assert(!c.inWorkView(archived,'work'));assert(c.inWorkView(archived,'archived'));
    for(const r of [qa,archived,real])assert(c.inWorkView(r,'all'));
    assert(!c.inWorkView({...qa,archived:true},'tests'));
    assert(c.inWorkView({...qa,isTest:false},'work'));
    assert(!c.isTestRecord({client:'Taylor Quinn',type:'Roof replacement'}));
  });
  for(const kind of ['project','estimate']){
    it(`archives and restores a ${kind} using only archive fields and preserves history`,async()=>{
      const record={id:'qa',client:'Customer',choices:[{name:'Quartz'}],dailyLogs:[{photo:'proof'}],lineItems:[{total:100}],status:'Completed'};
      const before=JSON.stringify(record);let writes=[];
      const collection={doc:id=>({update:async patch=>{assert.equal(id,'qa');writes.push({...patch});}})};
      const c=load({gpr:()=>record,ger:()=>record,col:collection,eCol:collection,rememberProjectSnapshot(){},renderAll(){},_renderDetail(){},renderEstCards(){},renderEstDetailBody(){},T(){}},['setRecordArchive']);
      await c.setRecordArchive(kind,true);assert(record.archived);assert.equal(writes[0].archived,true);assert.deepEqual(Object.keys(writes[0]).sort(),['archived','archivedAt']);
      await c.setRecordArchive(kind,false);assert.equal(record.archived,false);assert.equal(record.archivedAt,null);
      const {archived,archivedAt,...rest}=record;assert.equal(JSON.stringify(rest),before);
    });
  }
  it('does not hide a record when the archive write fails',async()=>{
    const record={id:'qa'};let notice='';
    const c=load({ger:()=>record,eCol:{doc:()=>({update:async()=>{throw Error('offline');}})},T:t=>notice=t},['setRecordArchive']);
    await c.setRecordArchive('estimate',true);assert.equal(record.archived,undefined);assert.match(notice,/Could not archive/);
  });
});
describe('save feedback',()=>{
  function fixture(){
    const nodes={syncDot:{style:{}},syncLabel:{},detail:{}};
    const c=load({pendingRecordSaves:0,lastRecordSavedAt:0,recordSaveError:false,document:{getElementById:id=>nodes[id],querySelectorAll:()=>[nodes.detail]}},['withSaveFeedback','setSS']);
    return {c,nodes};
  }
  it('shows Saving until concurrent writes finish, including on the detail page',async()=>{
    const {c,nodes}=fixture();const resolvers=[];
    const original={doc:()=>({set:()=>new Promise(resolve=>resolvers.push(resolve)),update:()=>Promise.resolve(),delete:()=>Promise.resolve()})};
    const collection=c.withSaveFeedback(original);
    const first=collection.doc('1').set({}),second=collection.doc('2').set({});
    assert.equal(nodes.detail.textContent,'Saving…');c.setSS('live');assert.equal(nodes.syncLabel.textContent,'Saving…');
    resolvers[0]();await first;assert.equal(nodes.syncLabel.textContent,'Saving…');
    resolvers[1]();await second;assert.match(nodes.detail.textContent,/Saved/);assert.equal(c.pendingRecordSaves,0);
  });
  it('keeps failed saves visible through snapshots and another pending write succeeding',async()=>{
    const {c,nodes}=fixture();let resolve,reject;
    const collection=c.withSaveFeedback({doc:id=>({set:()=>new Promise((ok,fail)=>{if(id==='bad')reject=fail;else resolve=ok;}),update:()=>Promise.resolve(),delete:()=>Promise.resolve()})});
    const bad=collection.doc('bad').set({}),good=collection.doc('good').set({});reject(Error('offline'));
    await assert.rejects(bad,/offline/);c.setSS('live');assert.match(nodes.detail.textContent,/Not saved/);
    resolve();await good;assert.match(nodes.detail.textContent,/Not saved/);
  });
});
describe('guided estimate answers',()=>{
  it('includes unknown details without dropping work or inventing a specification',()=>{
    const field={value:'',getAttribute:()=> '0'},prompt={value:''};
    const c=load({window:{_aiEstimateQuestionState:{questions:['What roof pitch?']}},document:{getElementById:id=>id==='aiPrompt'?prompt:field,querySelectorAll:()=>[field]}},['updateEstimateAnswers','setEstimateAnswer']);
    c.setEstimateAnswer(0);assert.match(prompt.value,/What roof pitch/);assert.match(prompt.value,/Unknown/);assert.match(prompt.value,/keep this work/);
  });
});
describe('simplified estimate layout',()=>{
  function fixture(questionState){
    const body={innerHTML:'',addEventListener(){}};
    const c=load({window:{location:{search:''},_aiEstimateQuestionState:questionState||{}},document:{body:{classList:{contains:()=>false}},getElementById:()=>body},DD:{companyName:'QA'},
      calcEstimate:()=>({subtotal:100,clientTotal:120,grandTotal:120,taxAmt:0,profit:20,margin:16.7}),fmt:()=> 'Oct 2',fmtTS:()=> 'Oct 2',generateContractText:()=> 'Test contract',
      renderResidentialNarrativeBlock:()=> '<div>Summary</div>'},['escapeHtmlText','isTestRecord','archiveControls','renderEstDetailBody']);
    return {c,body};
  }
  it('shows prices and main actions before details, and keeps expandable sections balanced',()=>{
    const {c,body}=fixture();c.renderEstDetailBody({id:'qa',client:'QA',status:'Draft',lineItems:[{desc:'Work',total:100,markup:20}],paymentMilestones:[]});
    const out=body.innerHTML;
    assert(out.indexOf('Grand Total')<out.indexOf('More estimate options'));
    assert(out.indexOf('Review &amp; send')<out.indexOf('More estimate options'));
    assert.equal((out.match(/<details\b/g)||[]).length,(out.match(/<\/details>/g)||[]).length);
    assert.match(out,/Archive estimate/);assert.match(out,/id="estimateReview"/);
  });
  it('uses question indexes in attributes and groups questions in threes',()=>{
    const {c,body}=fixture({active:true,questions:['Which "roof" <pitch>?','Doors?','Windows?','Floor?']});
    c.renderEstDetailBody({id:'qa',client:'QA',status:'Draft',lineItems:[]});
    assert.match(body.innerHTML,/Questions 1–3/);assert.match(body.innerHTML,/Questions 4–4/);
    assert.match(body.innerHTML,/data-est-question="0"/);assert.match(body.innerHTML,/&lt;pitch&gt;/);
    assert(!body.innerHTML.includes('data-est-question="Which'));
  });
});
