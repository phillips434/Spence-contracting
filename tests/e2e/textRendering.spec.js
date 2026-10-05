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
