const assert=require('assert'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
function source(name){const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);return html.slice(a,b);}
const payload='<img src=x onerror="alert(1)">';
describe('customer text rendering',()=>{
 function cards(name){const nodes={};const record={id:'" onmouseover="alert(1)',client:payload,type:payload,address:payload,status:payload,jobNum:payload,estNum:payload,pm:payload};const context={document:{getElementById:id=>nodes[id]||(nodes[id]={value:'',innerHTML:''}),querySelectorAll:()=>[]},projects:[record],estimates:[record],activeFilter:'All',projectWorkView:'work',estimateWorkView:'work',inWorkView:()=>true,sc:()=>null,gp:()=>0,daysLeft:()=>30,fmt:()=>'',EST_SC:{},calcEstimate:()=>({grandTotal:100,margin:20}),workViewButtons:()=>''};vm.runInNewContext(source('escapeHtmlText')+'\n'+source(name)+'\n'+name+'();',context);return nodes[name==='renderCards'?'cards':'estCards'].innerHTML;}
 for(const name of ['renderCards','renderEstCards'])it('renders stored markup as text in '+name,()=>{const result=cards(name);assert(!result.includes('<img'));assert(result.includes('&lt;img'));assert(!result.includes('data-id="" onmouseover'));assert(!result.includes('data-eid="" onmouseover'));});
 it('escapes summary and detailed scope in the customer narrative',()=>{const context={window:{},buildResidentialEstimateDescription:()=>({heading:payload,summary:payload,sections:[{key:'projectScope',label:payload,value:payload}]})};const result=vm.runInNewContext(source('escapeHtmlText')+'\n'+source('renderResidentialNarrativeBlock')+'\nrenderResidentialNarrativeBlock({},true);',context);assert(!result.includes('<img'));assert(result.includes('&lt;img'));});
 it('renders team names and contact details as text',()=>{
   const el={innerHTML:''};
   const context={DD:{team:[{name:payload,trade:payload,phone:payload,email:payload,type:'Sub'}]},document:{getElementById:()=>el}};
   vm.runInNewContext(source('escapeHtmlText')+'\n'+source('renderTeamList')+'\nrenderTeamList();',context);
   assert(!el.innerHTML.includes('<img'));assert.equal((el.innerHTML.match(/&lt;img/g)||[]).length,4);
 });

});
