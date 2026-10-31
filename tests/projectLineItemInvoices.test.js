describe('Project line-item invoices',()=>{
it('validates amounts, renders client-safe rows, and preserves invoices on failed saves',async()=>{
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
function source(name){let a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);return html.slice(a,b);}
const c={};vm.createContext(c);vm.runInContext(['validateProjectInvoiceItems','projectInvoiceRows','moneyAmount','escapeHtmlText'].map(source).join('\n'),c);
assert.equal(c.validateProjectInvoiceItems([{desc:'Framing',amount:100.01},{desc:'Labor',amount:50.02}],150.03).amount,150.03);
assert.throws(()=>c.validateProjectInvoiceItems([{desc:'Work',amount:200}],100),/must total/);
for(const item of [{desc:'',amount:1},{desc:'x',amount:-1},{desc:'x',amount:Infinity},{desc:'x',amount:'bad'}])assert.throws(()=>c.validateProjectInvoiceItems([item],null));
assert.equal(c.validateProjectInvoiceItems([{desc:'Work',amount:80}],null).amount,80);
const markup=c.projectInvoiceRows({name:'Progress',amount:150.03,lineItems:[{desc:'<script>bad</script>',amount:100.01},{desc:'Labor',amount:50.02}]});assert(!markup.includes('<script>'));assert(markup.includes('$100.01'));assert(markup.includes('white-space:nowrap'));assert(c.projectInvoiceRows({name:'Deposit',amount:100}).includes('Deposit'));
console.log('Invoice financial validation, client rendering, escaping, and all inline script syntax passed.');
{const p={id:'p1',paymentMilestones:[{name:'Progress',amount:150.03,paid:false}]};const ctx={projectInvoiceDraft:{projectId:'p1',index:0,original:JSON.stringify(p.paymentMilestones[0]),items:[{desc:'Work',amount:150.03}]},gpr:()=>p,document:{getElementById:id=>({value:id==='projectInvoiceName'?'Progress':'2026-10-20'})},alert(){},rememberProjectSnapshot(){},closeProjectInvoiceItems(){},renderTabBody(){},T(){},persistProjectChanges:async()=>{throw Error('offline')}};vm.createContext(ctx);vm.runInContext(['saveProjectInvoiceItems','validateProjectInvoiceItems','moneyAmount'].map(source).join('\n'),ctx);let before=JSON.stringify(p);ctx.saveProjectInvoiceItems();await new Promise(setImmediate);assert.equal(JSON.stringify(p),before);ctx.persistProjectChanges=async x=>x;ctx.saveProjectInvoiceItems();await new Promise(setImmediate);assert.equal(p.paymentMilestones[0].lineItems[0].amount,150.03);ctx.projectInvoiceDraft={projectId:'p1',index:-1,original:null,items:[{desc:'Additional work',amount:25}]};ctx.saveProjectInvoiceItems();await new Promise(setImmediate);assert.equal(p.paymentMilestones.length,2);assert.equal(p.paymentMilestones[1].amount,25);console.log('Save failure preservation, existing invoice persistence, and new bill creation passed.');}

});
});
