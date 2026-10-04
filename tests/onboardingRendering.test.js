const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const start=html.indexOf('function renderOnboarding('),end=html.indexOf('\nfunction ',start+1);
const source=html.slice(start,end);
function render(settings={},dismissed=false,team=false){return new Function('window','DD','localStorage','CD_LOGO_FULL',source+';return renderOnboarding();')({_sessionWorkspaceType:team?'team':'owner'},settings,{getItem:()=>dismissed?'1':null},'fixture-logo.svg');}
describe('onboarding screen HTML',()=>{
 it('renders the initial welcome without visible quotes surrounding the markup',()=>{const result=render();assert(result.startsWith('<div'));assert(result.endsWith('</div>'));assert(result.includes('Welcome to Contractor Desk'));assert(result.includes('<s>Create your account</s>'));assert(!result.includes('<s>Add your company name</s>'));});
 it('reflects persisted setup fields while retaining the first-project action',()=>{const result=render({companyName:'QA Company',logoData:'data:image/svg+xml;base64,fixture',team:[{name:'QA'}]});for(const label of ['Add your company name','Upload your logo','Add a team member'])assert(result.includes('<s>'+label+'</s>'));assert(result.includes('onclick="openAdd()"'));});
 it('renders the dismissed first-project state without quote characters or an onboarding checklist',()=>{const result=render({},true);assert(result.startsWith('<div'));assert(result.endsWith('</div>'));assert(result.includes('Ready to go!'));assert(!result.includes('Welcome to Contractor Desk'));});
 it('does not show owner setup to an invited team member',()=>assert.strictEqual(render({},false,true),''));
 function cards({projects=[],query='',filter='All',view='work',ready=true,team=false}={}){const node={innerHTML:''};const a=html.indexOf('function renderCards('),b=html.indexOf('\nfunction ',a+1);new Function('document','projects','activeFilter','projectWorkView','inWorkView','CD_USE_POSTGRES','estimatesSyncReady','renderOnboarding',html.slice(a,b)+';renderCards();')({getElementById:id=>id==='cards'?node:{value:query},querySelectorAll:()=>[]},projects,filter,view,()=>false,true,ready,()=>render({},false,team));return node.innerHTML;}
 it('shows the checklist for a newly loaded empty owner workspace',()=>assert(cards().includes('Welcome to Contractor Desk')));
 it('keeps empty filtered views distinct from a new account',()=>{for(const options of [{query:'missing'},{filter:'Completed'},{view:'archived'},{projects:[{id:'existing'}]},{team:true},{ready:false}]){const result=cards(options);assert(!result.includes('Welcome to Contractor Desk'));assert(result.includes('No projects in this view'));}});
});
