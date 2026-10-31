const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');
const start=html.indexOf('  function runEstimateRequest(payload){');
const end=html.indexOf('  function parseAIResponse(',start);
const source=html.slice(start,end);

function fixture(){
  let now=0,next=1,resolveFetch,rejectFetch,signal,done=0;
  const timers=new Map();
  const context={AbortController,document:{getElementById:()=>({style:{display:'block'}})},
    _aiStatus(){},_aiDone(){done++;},
    setTimeout(fn,ms){const id=next++;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout(id){timers.delete(id);},
    fetch(_url,options){signal=options.signal;return new Promise((resolve,reject)=>{
      resolveFetch=resolve;rejectFetch=reject;
      signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    });}};
  vm.createContext(context);vm.runInContext(source,context);
  return {request:payload=>context.runEstimateRequest(payload),
    advance(ms){now+=ms;for(const [id,timer] of timers){if(timer.at<=now){timers.delete(id);timer.fn();}}},
    respond(body){resolveFetch({ok:true,json:async()=>body});},
    headersWithPendingBody(){resolveFetch({ok:true,json:()=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});},
    get aborted(){return signal.aborted;},get pending(){return timers.size;},get done(){return done;}};
}

describe('estimate generation request deadline',()=>{
  it('accepts a successful generation after the observed 40-second provider latency',async()=>{
    const f=fixture(),pending=f.request({mode:'estimate-generate'});
    f.advance(40000);assert.strictEqual(f.aborted,false);
    const result={lineItems:[{desc:'Labor',qty:8,unitCost:85,total:680}]};
    f.respond(result);assert.deepStrictEqual(await pending,result);
    assert.strictEqual(f.pending,0);assert.strictEqual(f.done,1);
  });
  it('bounds a stalled generation at two minutes and clears its timers',async()=>{
    const f=fixture(),pending=f.request({mode:'estimate-generate'});
    f.advance(119999);assert.strictEqual(f.aborted,false);f.advance(1);
    await assert.rejects(pending,error=>error.code==='AI_TIMEOUT'&&/saved estimate was not changed/.test(error.message));
    assert.strictEqual(f.pending,0);assert.strictEqual(f.done,1);
  });
  it('keeps the deadline active while reading a stalled response body',async()=>{
    const f=fixture(),pending=f.request({mode:'estimate-intake'});
    f.headersWithPendingBody();await Promise.resolve();await Promise.resolve();
    f.advance(30000);
    await assert.rejects(pending,error=>error.code==='AI_TIMEOUT');
    assert.strictEqual(f.pending,0);
  });
});
