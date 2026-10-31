const assert=require('node:assert/strict');
const {dimensionCatalog,applyAreaTakeoffs}=require('../lib/flatAreaTakeoff');
const {estimateHandler}=require('../server');
const scope=`Metal faces 10'x9', 7'x11', 15'x11', 9'x8', 9'x11', 177 inches long x 10 feet; ceiling 9'x11'. Separate 20'x10' wall drywall only. One 36x80 inches door in an already counted face. 10% waste.`;
const takeoff={lineItemIndex:0,dimensionIndexes:[0,1,2,3,4,5,6],subtractDimensionIndexes:[8],wastePercent:10};
const response=()=>({lineItems:[{category:'Materials',desc:'MasterRib metal panels',qty:471,unit:'sf',unitCost:3.25,total:1530.75,isNewWork:true}],quantityTakeoffs:[{...takeoff}],updateItems:[],conditionsAssumptions:[]});

describe('Server rectangular material takeoffs',function(){
  it('converts inches, deducts openings and applies waste to all selected faces without including drywall',function(){
    const catalog=dimensionCatalog(scope),parsed=response();
    assert.equal(catalog[5].areaSF,147.5);assert.equal(catalog[8].areaSF,20);
    applyAreaTakeoffs(parsed,catalog);
    assert.equal(parsed.lineItems[0].qty,802.45);
    assert.match(parsed.conditionsAssumptions[0],/749.5 SF gross; less 20 SF openings; 10% waste = 802.45 SF/);
  });
  it('does not infer units or rewrite established updateItems',function(){
    assert.deepEqual(dimensionCatalog('Unspecified 12x16 and 36x80'),[]);
    const update={index:0,qty:471,unitCost:3.25,total:1530.75};
    const parsed={lineItems:[],quantityTakeoffs:[],updateItems:[update]};
    applyAreaTakeoffs(parsed,dimensionCatalog(scope));assert.deepEqual(parsed.updateItems,[update]);
  });
  it('rejects missing panel basis, duplicate/unknown references, invalid waste, excess deductions and labor targets',function(){
    const catalog=dimensionCatalog(scope);
    const bad=response();bad.quantityTakeoffs=[];assert.throws(()=>applyAreaTakeoffs(bad,catalog),/require/);
    for(const overrides of [{dimensionIndexes:[0,0]},{dimensionIndexes:[99]},{subtractDimensionIndexes:[0]},{wastePercent:-1},{wastePercent:Infinity},{dimensionIndexes:[0],subtractDimensionIndexes:[7]}]){
      const parsed=response();Object.assign(parsed.quantityTakeoffs[0],overrides);assert.throws(()=>applyAreaTakeoffs(parsed,catalog));
    }
    const labor=response();labor.lineItems[0].category='Labor';assert.throws(()=>applyAreaTakeoffs(labor,catalog));
  });
  it('corrects an incorrect provider quantity and direct total through the actual generation handler',async function(){
    const oldFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY;let status,result,payload;
    process.env.OPENAI_API_KEY='synthetic-provider-test';
    global.fetch=async(_url,options)=>{payload=JSON.parse(options.body);return {status:200,ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response())}}]})};};
    try{
      await estimateHandler({body:{mode:'estimate-generate',prompt:scope,items:'[]',laborRate:85},headers:{}},{status(code){status=code;return this;},json(value){result=value;return this;}});
      assert.equal(status,200);const parsed=JSON.parse(result.content[0].text);
      assert.equal(parsed.lineItems[0].qty,802.45);assert.equal(parsed.lineItems[0].total,2607.96);
      assert.match(payload.messages[0].content,/RECTANGULAR AREA TAKEOFF/);
      assert.ok(payload.response_format.json_schema.schema.required.includes('quantityTakeoffs'));
    }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
  });
});
