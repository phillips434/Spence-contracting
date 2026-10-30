const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const {estimateHandler}=require('../server');
describe('estimator provider health',()=>{
  let originalFetch,oldKey;
  beforeEach(()=>{originalFetch=global.fetch;oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='  existing-test-key\n';});
  afterEach(()=>{global.fetch=originalFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;});
  async function request(body){let status=200,result;await estimateHandler({body,headers:{}},{status(n){status=n;return this;},json(data){result=data;return this;}});return {status,data:result};}
  it('checks GPT-4.1 with the same normalized existing key used for estimates',async()=>{
    let sent;global.fetch=async(url,opts)=>{sent={url,...opts};return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'OK'}}]})};};
    const result=await request({mode:'ai-health',max_tokens:20,messages:[{role:'user',content:'Reply with OK only.'}]});
    assert.equal(result.status,200);assert.equal(result.data.content[0].text,'OK');assert.equal(sent.url,'https://api.openai.com/v1/chat/completions');assert.equal(sent.headers.Authorization,'Bearer existing-test-key');assert.equal(JSON.parse(sent.body).model,'gpt-4.1');
  });
  for(const mode of ['ai-health','estimate-intake','estimate-generate','estimate-exclusions','change-order-intake','change-order-generate'])it('reports a rejected key safely for '+mode,async()=>{
    global.fetch=async()=>({ok:false,status:401,text:async()=>JSON.stringify({error:{message:'Incorrect API key provided: SECRET-MUST-NOT-LEAK'}})});
    const result=await request({mode,prompt:'Check connection',items:'[]'});assert.equal(result.status,503);assert.equal(result.data.error,'ai_authentication_failed');assert.equal(result.data.providerStatus,401);assert(!JSON.stringify(result).includes('SECRET-MUST-NOT-LEAK'));assert(!result.data.lineItems);
  });
  it('does not fall back to Claude if the estimator key is missing',async()=>{
    process.env.OPENAI_API_KEY='   ';global.fetch=async()=>{throw Error('Provider must not be called');};const result=await request({mode:'ai-health'});assert.equal(result.status,503);
  });
  it('the settings test cannot show success when estimator authentication fails',async()=>{
    const html=fs.readFileSync(require('path').join(__dirname,'../public/index.html'),'utf8');const a=html.indexOf('async function testAIConnection(){'),b=html.indexOf('\nfunction saveCompanyName',a);const el={style:{}};let payload;
    const context={document:{getElementById:()=>el},AbortController,Date,setTimeout,clearTimeout,fetch:async(_url,opts)=>{payload=JSON.parse(opts.body);return {ok:false,status:503,json:async()=>({error:'ai_authentication_failed'})};}};
    vm.runInNewContext(html.slice(a,b),context);await context.testAIConnection();assert.equal(payload.mode,'ai-health');assert.match(el.textContent,/OpenAI rejected/);assert(!el.textContent.includes('working'));
  });
});
