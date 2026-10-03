const { getPool } = require('../db/postgres');

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function txt(v){return v==null?null:String(v);}
function dateOrNull(v){if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);}
function timestampOrNull(v){if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d;}

async function saveProjectDocument(client,companyId,p){
  if(!p||!p.id)throw new Error('Project id is required');
  const pr=await client.query(`insert into projects(company_id,legacy_id,job_number,po_number,name,project_type,address,status,project_manager,start_date,end_date,budget,spent,notes,archived,legacy_payload)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
    on conflict(company_id,legacy_id) do update set job_number=excluded.job_number,po_number=excluded.po_number,name=excluded.name,project_type=excluded.project_type,address=excluded.address,status=excluded.status,project_manager=excluded.project_manager,start_date=excluded.start_date,end_date=excluded.end_date,budget=excluded.budget,spent=excluded.spent,notes=excluded.notes,archived=excluded.archived,legacy_payload=excluded.legacy_payload,updated_at=now() returning id`,
    [companyId,txt(p.id),txt(p.jobNum||p.jobNumber),txt(p.po||p.poNumber),txt(p.client||p.name),txt(p.type),txt(p.address),txt(p.status),txt(p.pm||p.projectManager),dateOrNull(p.startDate||p.start),dateOrNull(p.endDate||p.end),n(p.budget),n(p.spent),txt(p.notes),p.archived===true,JSON.stringify(p)]);
  const pid=pr.rows[0].id;
  for(const table of ['project_scope_items','project_selections','project_punch_items','change_orders','communications','daily_logs','project_notes_log','project_payment_milestones','project_costs'])await client.query('delete from '+table+' where project_id=$1',[pid]);
  for(const [i,x] of (p.scopeItems||p.phases||[]).entries())await client.query('insert into project_scope_items(project_id,position,description,start_date,end_date,budget_amount,actual_amount,status,assigned_to,assigned_phone,assigned_email,category,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)',[pid,i,txt(x.desc||x.name),dateOrNull(x.start),dateOrNull(x.end),n(x.budget),n(x.actual),txt(x.complete||x.status),txt(x.assignTo||x.subcontractor),txt(x.assignPhone||x.phone),txt(x.assignEmail||x.email),txt(x.category||x.type),JSON.stringify(x)]);
  for(const [i,x] of (p.choices||[]).entries())await client.query('insert into project_selections(project_id,legacy_key,category,item,vendor,notes,status,budget_amount,actual_amount,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[pid,txt(x.id||i),txt(x.category),txt(x.item||x.name),txt(x.vendor),txt(x.notes),txt(x.status),n(x.budgetAmt||x.budget),n(x.actualAmt||x.actual),JSON.stringify(x)]);
  for(const [i,x] of (p.punchList||[]).entries())await client.query('insert into project_punch_items(project_id,position,item_text,done,category,legacy_payload) values($1,$2,$3,$4,$5,$6::jsonb)',[pid,i,txt(x.text||x.item),x.done===true,txt(x.category),JSON.stringify(x)]);
  for(const [i,x] of (p.changeOrders||[]).entries())await client.query('insert into change_orders(project_id,legacy_key,title,description,status,amount,legacy_payload) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[pid,txt(x.id||i),txt(x.title||x.name),txt(x.description||x.desc),txt(x.status),n(x.amount||x.total||x.budgetImpact),JSON.stringify(x)]);
  for(const [i,x] of (p.dailyLogs||[]).entries())await client.query('insert into daily_logs(project_id,legacy_key,log_date,crew,weather,work_performed,issues,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[pid,txt(x.id||i),dateOrNull(x.date||x.logDate),txt(x.crew),txt(x.weather),txt(x.workPerformed||x.work||x.notes),txt(x.issues),JSON.stringify(x)]);
  for(const [i,x] of (p.commsLog||p.communications||p.communicationLog||[]).entries())await client.query('insert into communications(project_id,legacy_key,communication_type,occurred_at,notes,follow_up,legacy_payload) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[pid,txt(x.id||i),txt(x.type),timestampOrNull(x.date||x.occurredAt||x.occurred),txt(x.notes||x.message),txt(x.followUp),JSON.stringify(x)]);
  for(const [i,x] of (p.notesLog||[]).entries())await client.query('insert into project_notes_log(project_id,position,note_date,note_text,priority,author,resolved,occurred_at,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[pid,i,dateOrNull(x.date),txt(x.text),txt(x.priority),txt(x.author),x.resolved===true,timestampOrNull(x.ts||x.occurredAt||x.occurred),JSON.stringify(x)]);
  for(const [i,x] of (p.paymentMilestones||[]).entries())await client.query('insert into project_payment_milestones(project_id,position,label,amount,percent,due_date,status,paid,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[pid,i,txt(x.label||x.name||x.description),n(x.amount),n(x.percent||x.pct),dateOrNull(x.dueDate||x.date),txt(x.status),x.paid===true,JSON.stringify(x)]);
  for(const [i,x] of (p.costs||[]).entries())await client.query('insert into project_costs(project_id,legacy_key,source_type,category,description,budget_amount,actual_amount,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[pid,txt(x.id||i),txt(x.sourceType),txt(x.category),txt(x.description),n(x.budgetAmt||x.budget),n(x.actualAmt||x.actual),JSON.stringify(x)]);
  return pid;
}

async function saveEstimateDocument(client,companyId,e){
  if(!e||!e.id)throw new Error('Estimate id is required');
  const scope=e.customerScope||{};
  const er=await client.query(`insert into estimates(company_id,legacy_id,estimate_number,title,project_class,status,markup,tax_rate,residential_summary,project_scope,converted,archived,legacy_payload)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    on conflict(company_id,legacy_id) do update set estimate_number=excluded.estimate_number,title=excluded.title,project_class=excluded.project_class,status=excluded.status,markup=excluded.markup,tax_rate=excluded.tax_rate,residential_summary=excluded.residential_summary,project_scope=excluded.project_scope,converted=excluded.converted,archived=excluded.archived,legacy_payload=excluded.legacy_payload,updated_at=now() returning id`,
    [companyId,txt(e.id),txt(e.estNum||e.estimateNumber),txt(e.client||e.title),txt(e.projectClass||e.type),txt(e.status),n(e.markup),n(e.taxRate),txt(scope.residentialSummary||e.residentialSummary),txt(scope.projectScope||e.projectScope),e.converted===true,e.archived===true,JSON.stringify(e)]);
  const eid=er.rows[0].id;
  await client.query('delete from estimate_items where estimate_id=$1',[eid]);
  await client.query('delete from estimate_payment_milestones where estimate_id=$1',[eid]);
  for(const [i,x] of (e.paymentMilestones||[]).entries())await client.query('insert into estimate_payment_milestones(estimate_id,position,label,amount,percent,due_date,status,paid,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[eid,i,txt(x.label||x.name||x.description),n(x.amount),n(x.percent||x.pct),dateOrNull(x.dueDate||x.date),txt(x.status),x.paid===true,JSON.stringify(x)]);
  for(const [i,x] of (e.lineItems||[]).entries())await client.query('insert into estimate_items(estimate_id,position,category,description,quantity,unit,unit_cost,total,markup,legacy_payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[eid,i,txt(x.category),txt(x.desc||x.description),n(x.qty),txt(x.unit),n(x.unitCost),n(x.total),n(x.markup),JSON.stringify(x)]);
  return eid;
}

async function transact(fn){
  const client=await getPool().connect();
  try{await client.query('begin');const out=await fn(client);await client.query('commit');return out;}
  catch(err){await client.query('rollback');throw err;}
  finally{client.release();}
}

module.exports={n,txt,dateOrNull,timestampOrNull,saveProjectDocument,saveEstimateDocument,transact};
