const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const http=require('http');
const {app,removeAnsweredIntakeQuestions}=require('../server');
const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
function source(name){const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);assert(a>=0&&b>a);return html.slice(a,b);}
const clone=x=>JSON.parse(JSON.stringify(x));
describe('payment schedule rounding',()=>{
  it('uses the final milestone as the exact remaining balance',async()=>{
    for(const total of [1632,7405.20,53,100.01]){
      const estimate={id:'qa'};let saved;
      const c={ger:()=>estimate,calcEstimate:()=>({grandTotal:total}),eCol:{doc:()=>({set:async e=>{saved=clone(e);}})},T(){},renderEstDetailBody(){}};
      vm.createContext(c);vm.runInContext(source('autoGenMilestones'),c);c.autoGenMilestones();
      await new Promise(resolve=>setImmediate(resolve));
      assert.strictEqual(Math.round(saved.paymentMilestones.reduce((sum,m)=>sum+m.amount,0)*100),Math.round(total*100));
    }
  });
});
describe('open estimate recovery after sync loss',()=>{
  function fixture(record){
    const c={currentEstId:'deck',currentUser:{uid:'office'},estimates:[],resolveCurrentOwnerUid:async()=> 'owner',
      eCol:{doc:()=>({get:async()=>({id:'deck',exists:!!record,data:()=>clone(record)})})}};
    vm.createContext(c);vm.runInContext(source('recoverOpenEstimate'),c);return c;
  }
  it('restores the visible company estimate after its cached list is cleared',async()=>{
    const c=fixture({client:'Phillip',type:'Deck',userId:'owner',lineItems:[]});
    const result=await c.recoverOpenEstimate();assert.strictEqual(result.id,'deck');assert.strictEqual(c.estimates[0].client,'Phillip');
  });
  it('refuses another company record even if public Firestore rules return it',async()=>{
    const c=fixture({userId:'other-company'});await assert.rejects(c.recoverOpenEstimate(),/not available/);assert.strictEqual(c.estimates.length,0);
  });
  it('does not restore deleted or converted estimates',async()=>{
    await assert.rejects(fixture(null).recoverOpenEstimate(),/no longer exists/);
    await assert.rejects(fixture({userId:'owner',converted:true}).recoverOpenEstimate(),/converted/);
  });
});
describe('reported selection loss',()=>{
  function fixture(){
    let stored={id:'p1',client:'Client',notes:'',choices:[{category:'Cabinet',item:'Oak'},{category:'Countertop',item:'Quartz'}]};
    const c={col:{doc:id=>({id,set:async value=>{stored=clone(value);}})},db:{runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>clone(stored)}),update:(_ref,patch)=>{stored=Object.assign(stored,clone(patch));}})}};
    vm.createContext(c);for(const name of ['rememberProjectSnapshot','projectFieldEqual','persistProjectChanges'])vm.runInContext(source(name),c);
    return {c,read:()=>clone(stored),remote:patch=>{stored=Object.assign(stored,clone(patch));}};
  }
  it('preserves a newer backsplash selection when an older office view saves notes',async()=>{
    const {c,read,remote}=fixture();const p=c.rememberProjectSnapshot(read());
    remote({choices:read().choices.concat({category:'Backsplash',item:'Tile'})});p.notes='Office note';
    const saved=await c.persistProjectChanges(p,p._savedProjectSnapshot);
    assert.strictEqual(read().choices.length,3);assert.strictEqual(saved.choices[2].item,'Tile');assert.strictEqual(read().notes,'Office note');
  });
  it('accepts unchanged values returned with reordered Firestore object fields',async()=>{
    const {c,read,remote}=fixture();const p=c.rememberProjectSnapshot(read());
    remote({choices:read().choices.map(item=>({item:item.item,category:item.category}))});
    p.choices[0].item='Maple';
    await c.persistProjectChanges(p,p._savedProjectSnapshot);
    assert.strictEqual(read().choices[0].item,'Maple');
  });
  it('rejects conflicting selection edits without erasing either saved selection',async()=>{
    const {c,read,remote}=fixture();const p=c.rememberProjectSnapshot(read());
    remote({choices:read().choices.concat({category:'Backsplash',item:'Tile'})});p.choices[0].item='Maple';
    await assert.rejects(c.persistProjectChanges(p,p._savedProjectSnapshot),/Another person changed choices/);
    assert.strictEqual(read().choices[0].item,'Oak');assert.strictEqual(read().choices.length,3);
  });
  it('persists all selection fields through save and reload',async()=>{
    const {c,read}=fixture();const p=c.rememberProjectSnapshot(read());
    p.choices.push({category:'Backsplash',item:'Tile',vendor:'Supplier',notes:'Confirm grout',status:'Ordered',budgetAmt:500,actualAmt:450});
    await c.persistProjectChanges(p,p._savedProjectSnapshot);
    assert.deepStrictEqual(read().choices[2],p.choices[2]);
    assert(!JSON.stringify(p).includes('_savedProjectSnapshot'));
  });
});
describe('answered estimate intake questions',()=>{
  it('accepts unknown roof and deck answers without asking identical questions again',()=>{
    const result=removeAnsweredIntakeQuestions({action:'questions',questions:['What is the roof pitch?','What is the deck height?']},{history:[{questions:['What is the roof pitch?','What is the deck height?'],answer:"I don't know. Use assumptions."}]});
    assert.strictEqual(result.action,'ready');
  });
  it('keeps newly identified questions and ignores punctuation differences',()=>{
    const result=removeAnsweredIntakeQuestions({action:'questions',questions:['What is the roof pitch','How many windows?']},{history:[{questions:['What is the roof pitch?'],answer:'Unknown'}]});
    assert.deepStrictEqual(result.questions,['How many windows?']);
  });
  it('does not treat a blank answer as resolved',()=>{
    const result=removeAnsweredIntakeQuestions({action:'questions',questions:['Roof pitch?']},{history:[{questions:['Roof pitch?'],answer:' '}]});assert.strictEqual(result.action,'questions');
  });
});
async function request(payload){
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  try{return await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/estimate',method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));
    });req.on('error',reject);req.end(JSON.stringify(payload));
  });}finally{await new Promise(resolve=>server.close(resolve));}
}
describe('AI exclusions request',()=>{
  it('uses an exclusions-only schema and accepts suggestions without line items',async()=>{
    const original=global.fetch,oldKey=process.env.OPENAI_API_KEY;let sent;
    process.env.OPENAI_API_KEY='test-key';global.fetch=async(_url,opts)=>{sent=JSON.parse(opts.body);return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'exclusions',exclusions:['Owner supplied appliances'],message:'Review suggestions'})}}]})};};
    try{const res=await request({mode:'estimate-exclusions',prompt:'Generate standard exclusions for kitchen remodel',items:'[]',excls:'[]'});
      assert.strictEqual(res.status,200);assert.deepStrictEqual(res.data.exclusions,['Owner supplied appliances']);
      assert(!sent.response_format.json_schema.schema.required.includes('lineItems'));
      assert.strictEqual(sent.model,'gpt-4.1');
    }finally{global.fetch=original;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
  });
});

describe('reported communication and daily log failures',()=>{
  it('builds a combined work order with both scopes and their combined amount',()=>{
    let opened;
    const p={id:'job',client:'Customer',scopeItems:[{desc:'Electrical',actual:600,assignTo:'Alex',assignEmail:'alex@example.com'},{desc:'Plumbing',actual:400,assignTo:'Alex'}]};
    const c={gpr:()=>p,DD:{companyName:'Company'},T(){},window:{location:{origin:'https://example.com',pathname:'/'},open:url=>opened=url}};
    vm.runInNewContext(source('sendCombinedSubPortalLink'),c);c.sendCombinedSubPortalLink([0,1]);
    const decoded=decodeURIComponent(opened);assert(decoded.includes('Electrical'));assert(decoded.includes('Plumbing'));assert(decoded.includes('$1,000'));assert(decoded.includes('scopes=0,1'));
  });
  it('does not mark an invoice sent when no recipient contact is available',()=>{
    let saves=0;const p={client:'Customer',paymentMilestones:[{name:'Deposit',amount:500}]};
    const c={gpr:()=>p,DD:{},window:{location:{origin:'https://example.com',pathname:'/'}},alert(){},saveP:()=>saves++};
    vm.runInNewContext(source('sendProjectInvoice'),c);c.sendProjectInvoice(0);
    assert.strictEqual(p.paymentMilestones[0].sentAt,undefined);assert.strictEqual(saves,0);
  });
  it('subcontractor log resolves the crew from the assigned scope without an undefined variable',async()=>{
    let saved;const nodes={sWork:{value:'Wiring complete'},sWeather:{value:'Clear'},sIssues:{value:''},sDate:{value:'2026-10-02'},sPhoto:{files:[]},sStatus:{style:{}}};
    const c={document:{getElementById:id=>nodes[id]},alert(){},col:{doc:()=>({get:async()=>({exists:true,data:()=>({id:'p1',scopeItems:[{assignTo:'Alex'}]})})})},persistProjectChanges:async p=>{saved=clone(p);}};
    vm.createContext(c);vm.runInContext(source('rememberProjectSnapshot'),c);vm.runInContext(source('submitSubLog'),c);
    c.submitSubLog('p1',0);await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(saved.dailyLogs[0].crew,'Alex');assert.strictEqual(saved.dailyLogs[0].work,'Wiring complete');assert.strictEqual(nodes.sWork.value,'');
  });
});

describe('estimate browser request routing',()=>{
  function fixture(prompt,estimate,response){
    const calls=[],patches=[];const input={value:prompt};
    const c={console,window:{},currentUser:null,DD:{aiProfile:{}},ger:()=>estimate,T(){},
      document:{querySelectorAll:()=>[],getElementById:id=>id==='aiPrompt'?input:id==='aiLoading'?{style:{}}:null},
      eCol:{doc:()=>({update:async patch=>patches.push(clone(patch)),set:async()=>{}})},
      renderEstDetailBody(){},AbortController:class{abort(){}},setTimeout:()=>0,clearTimeout(){},
      fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>response};}};
    vm.createContext(c);
    for(const name of ['normalizeProjectClass','shouldUseIntakeGate','generateAIEstimate'])vm.runInContext(source(name),c);
    return {c,calls,patches};
  }
  it('a new kitchen addition asks intake questions even when the description begins with Add',async()=>{
    const {c,calls}=fixture('Add a kitchen addition with cabinets and countertops',{id:'kitchen',projectClass:'residential',lineItems:[]},{action:'questions',questions:['What are the kitchen dimensions?']});
    c.generateAIEstimate();await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(calls[0].mode,'estimate-intake');assert.strictEqual(c.window._aiEstimateQuestionState.active,true);
  });
  it('exclusions update only exclusions and preserve existing scope, prices and assumptions',async()=>{
    const e={id:'kitchen',projectClass:'residential',lineItems:[{desc:'Cabinets',total:5000}],exclusions:['Painting'],customerScope:{projectScope:'Complete kitchen',conditionsAssumptions:['Verify measurements']}};
    const before=clone(e);const {c,calls,patches}=fixture('Generate standard exclusions for kitchen',e,{action:'exclusions',exclusions:['Painting','Owner appliances'],message:'Review'});
    c.generateAIEstimate();await new Promise(resolve=>setImmediate(resolve));
    assert.strictEqual(calls[0].mode,'estimate-exclusions');
    assert.deepStrictEqual(patches,[{exclusions:['Painting','Owner appliances']}]);
    assert.deepStrictEqual(e.lineItems,before.lineItems);assert.deepStrictEqual(e.customerScope,before.customerScope);
  });
});


describe('safe project attachment saves',()=>{
  it('retains older daily photos when saving a large project',async()=>{
    const record={dailyLogs:Array.from({length:4},()=>({photos:['x'.repeat(180000)]}))};let saved;
    const c={setSS(){},withSharedOwnerMetadata:async()=>record,persistProjectChanges:async value=>{saved=clone(value);return value;},rememberProjectSnapshot(){},T(){}};
    c.syncProjectCostLedger=()=>{};vm.runInNewContext(source('saveP'),c);await c.saveP(record);
    assert.strictEqual(saved.dailyLogs.length,4);assert(saved.dailyLogs.every(log=>log.photos[0].length===180000));
  });
  it('rejects an oversized project without removing any photo or writing it',async()=>{
    const record={dailyLogs:[{photos:['x'.repeat(960000)]}]};let writes=0;
    const c={setSS(){},withSharedOwnerMetadata:async()=>record,persistProjectChanges:async()=>writes++,T(){}};
    c.syncProjectCostLedger=()=>{};vm.runInNewContext(source('saveP'),c);await assert.rejects(c.saveP(record),/too large/);
    assert.strictEqual(writes,0);assert.strictEqual(record.dailyLogs[0].photos[0].length,960000);
  });
});
describe('estimate sending without a recipient',()=>{
  it('keeps a draft unsent and does not save when contact details are missing',()=>{
    const record={id:'qa',status:'Draft',type:'Test'};let writes=0,alerts=0;
    const c={ger:()=>record,window:{location:{href:'https://example.com'}},calcEstimate:()=>({grandTotal:500}),DD:{},alert:()=>alerts++,eCol:{doc:()=>({set:()=>writes++})}};
    vm.runInNewContext(source('sendEstimate'),c);c.sendEstimate();
    assert.strictEqual(record.status,'Draft');assert.strictEqual(writes,0);assert.strictEqual(alerts,1);
  });
});
