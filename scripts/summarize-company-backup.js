const fs=require('fs');
function sum(a,f){return a.reduce((s,x)=>s+(Number(f(x))||0),0);}
const file=process.argv[2];if(!file)throw new Error('backup path required');
const b=JSON.parse(fs.readFileSync(file,'utf8'));
const report={
 schemaVersion:b.schemaVersion,
 workspaceUid:b.workspaceUid,
 projects:b.projects.length,
 estimates:b.estimates.length,
 projectBudget:Number(sum(b.projects,p=>p.budget).toFixed(2)),
 projectSpent:Number(sum(b.projects,p=>p.spent).toFixed(2)),
 estimateLineItems:b.estimates.reduce((s,e)=>s+(e.lineItems||e.items||[]).length,0),
 selections:b.projects.reduce((s,p)=>s+(p.choices||[]).length,0),
 changeOrders:b.projects.reduce((s,p)=>s+(p.changeOrders||[]).length,0),
 dailyLogs:b.projects.reduce((s,p)=>s+(p.dailyLogs||[]).length,0),
 communications:b.projects.reduce((s,p)=>s+(p.commsLog||p.communications||p.communicationLog||[]).length,0),
 costs:b.projects.reduce((s,p)=>s+(p.costs||[]).length,0),
 scopeItems:b.projects.reduce((s,p)=>s+(p.scopeItems||p.phases||[]).length,0),
 punchItems:b.projects.reduce((s,p)=>s+(p.punchList||[]).length,0),
 notesLog:b.projects.reduce((s,p)=>s+(p.notesLog||[]).length,0),
 projectPaymentMilestones:b.projects.reduce((s,p)=>s+(p.paymentMilestones||[]).length,0),
 estimatePaymentMilestones:b.estimates.reduce((s,e)=>s+(e.paymentMilestones||[]).length,0)
};
console.log(JSON.stringify(report,null,2));
