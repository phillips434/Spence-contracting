const assert=require('node:assert/strict');
const {estimateHandler,normalizeFlatGeneratedItems}=require('../server');

describe('Flat estimate labor and material pricing',function(){
  it('uses the company labor rate and recomputes new direct totals without changing existing-item updates',function(){
    const update={index:0,qty:4,unitCost:100,total:400};
    const parsed={lineItems:[{category:'Labor',qty:8,unit:'hrs',unitCost:1,total:1},{category:'Materials',qty:16,unit:'lf',unitCost:145,total:999}],updateItems:[update]};
    normalizeFlatGeneratedItems(parsed,85);
    assert.equal(parsed.lineItems[0].unitCost,85);
    assert.equal(parsed.lineItems[0].total,680);
    assert.equal(parsed.lineItems[1].total,2320);
    assert.deepEqual(parsed.updateItems,[update]);
  });
  it('rejects negative costs and labor measured as floor area',function(){
    assert.throws(()=>normalizeFlatGeneratedItems({lineItems:[{category:'Materials',qty:1,unitCost:-10}]},85));
    assert.throws(()=>normalizeFlatGeneratedItems({lineItems:[{category:'Labor',qty:192,unit:'sf',unitCost:18}]},85));
  });
  it('sends separate labor/material rules to the provider and returns corrected labor costs',async function(){
    const previousFetch=global.fetch,previousKey=process.env.OPENAI_API_KEY;
    let payload,status,result;
    process.env.OPENAI_API_KEY='synthetic-provider-test';
    global.fetch=async(_url,options)=>{
      payload=JSON.parse(options.body);
      return {status:200,ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'add',lineItems:[{category:'Labor',desc:'Install wall panels',qty:12,unit:'hrs',unitCost:2,total:24,isNewWork:false},{category:'Materials',desc:'MasterRib panels',qty:400,unit:'sf',unitCost:2,total:800,isNewWork:false}],updateItems:[]})}}]})};
    };
    try{
      await estimateHandler({body:{mode:'estimate-generate',prompt:'Supply and install 400 sf interior MasterRib metal wall panels',items:'[]',laborRate:85},headers:{}},{status(code){status=code;return this;},json(value){result=value;return this;}});
      assert.equal(status,200);
      const prompt=payload.messages[0].content;
      assert.ok(prompt.includes('include both the complete Materials package and separate Labor rows'));
      assert.ok(prompt.includes('Only Materials rows use direct material acquisition cost'));
      assert.ok(prompt.includes('INITIAL ESTIMATE RULE: Current items is empty'));
      const parsed=JSON.parse(result.content[0].text);
      assert.equal(parsed.lineItems[0].total,1020);
      assert.equal(parsed.lineItems[1].total,800);
      assert.ok(parsed.lineItems.every(item=>item.isNewWork===true),'Initial component rows must survive the browser new-work filter');
    }finally{
      global.fetch=previousFetch;
      if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
    }
  });
  it('preserves existing-estimate classification and accepts only valid targeted updates',async function(){
    const oldFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY;
    let status,result,providerPrompt;
    const update={index:0,category:'Labor',desc:'Existing labor',qty:4,unit:'hrs',unitCost:85,total:340,markup:20};
    const response={action:'add',lineItems:[{category:'Materials',desc:'Component of existing work',qty:1,unit:'ea',unitCost:10,total:10,isNewWork:false}],updateItems:[update]};
    process.env.OPENAI_API_KEY='synthetic-provider-test';
    global.fetch=async(_url,options)=>{providerPrompt=JSON.parse(options.body).messages[0].content;return {status:200,ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}]})};};
    const run=()=>estimateHandler({body:{mode:'estimate-generate',prompt:'Clarify existing labor',items:JSON.stringify([update]),laborRate:85},headers:{}},{status(code){status=code;return this;},json(value){result=value;return this;}});
    try{
      await run();assert.equal(status,200);
      const parsed=JSON.parse(result.content[0].text);
      assert.equal(parsed.lineItems[0].isNewWork,false);assert.deepEqual(parsed.updateItems,[update]);
      assert.ok(!providerPrompt.includes('INITIAL ESTIMATE RULE: Current items is empty'));
      response.updateItems=[];await run();assert.equal(status,502);assert.equal(result.error,'generation_failed');
    }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
  });
});
