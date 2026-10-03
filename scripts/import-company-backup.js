const fs = require('fs');
const { getPool } = require('../db/postgres');

const OWNER_UID = 'L5XUqfnWrrgbAk18X36XcHDJxnz1';

function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }
function text(v){ return v == null ? null : String(v); }
function dateOrNull(v){ if(!v)return null; const d=new Date(v); return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10); }

async function upsertCompany(client, backup){
  const name = backup.settings && (backup.settings.companyName || backup.settings.company) || 'Spence Construction & Remodeling Inc.';
  const r=await client.query(
    `insert into companies(legacy_owner_uid,name) values($1,$2)
     on conflict(legacy_owner_uid) do update set name=excluded.name,updated_at=now()
     returning id`,[backup.workspaceUid||OWNER_UID,name]);
  return r.rows[0].id;
}

async function upsertProject(client, companyId, p){
  const r=await client.query(
    `insert into projects(company_id,legacy_id,job_number,po_number,name,project_type,address,status,project_manager,start_date,end_date,budget,spent,notes,archived,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     on conflict(company_id,legacy_id) do update set
       job_number=excluded.job_number,po_number=excluded.po_number,name=excluded.name,project_type=excluded.project_type,
       address=excluded.address,status=excluded.status,project_manager=excluded.project_manager,start_date=excluded.start_date,
       end_date=excluded.end_date,budget=excluded.budget,spent=excluded.spent,notes=excluded.notes,archived=excluded.archived,
       legacy_payload=excluded.legacy_payload,updated_at=now()
     returning id`,
    [companyId,text(p.id),text(p.jobNum||p.jobNumber),text(p.po||p.poNumber),text(p.client||p.name),text(p.type),text(p.address),text(p.status),text(p.pm||p.projectManager),dateOrNull(p.startDate||p.start),dateOrNull(p.endDate||p.end),n(p.budget),n(p.spent),text(p.notes),p.archived===true,JSON.stringify(p)]);
  return r.rows[0].id;
}

async function replaceProjectChildren(client, projectId, p){
  await client.query('delete from project_selections where project_id=$1',[projectId]);
  await client.query('delete from change_orders where project_id=$1',[projectId]);
  await client.query('delete from daily_logs where project_id=$1',[projectId]);
  await client.query('delete from communications where project_id=$1',[projectId]);
  await client.query('delete from project_costs where project_id=$1',[projectId]);

  for(const [i,x] of (p.choices||[]).entries()) await client.query(
    `insert into project_selections(project_id,legacy_key,category,item,vendor,notes,status,budget_amount,actual_amount,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [projectId,text(x.id||i),text(x.category),text(x.item||x.name),text(x.vendor),text(x.notes),text(x.status),n(x.budgetAmt||x.budget),n(x.actualAmt||x.actual),JSON.stringify(x)]);
  for(const [i,x] of (p.changeOrders||[]).entries()) await client.query(
    `insert into change_orders(project_id,legacy_key,title,description,status,amount,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [projectId,text(x.id||i),text(x.title||x.name),text(x.description||x.desc),text(x.status),n(x.amount||x.total||x.budgetImpact),JSON.stringify(x)]);
  for(const [i,x] of (p.dailyLogs||[]).entries()) await client.query(
    `insert into daily_logs(project_id,legacy_key,log_date,crew,weather,work_performed,issues,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [projectId,text(x.id||i),dateOrNull(x.date||x.logDate),text(x.crew),text(x.weather),text(x.workPerformed||x.work||x.notes),text(x.issues),JSON.stringify(x)]);
  for(const [i,x] of (p.communications||p.communicationLog||[]).entries()) await client.query(
    `insert into communications(project_id,legacy_key,communication_type,occurred_at,notes,follow_up,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [projectId,text(x.id||i),text(x.type),x.date?new Date(x.date):null,text(x.notes||x.message),text(x.followUp),JSON.stringify(x)]);
  for(const [i,x] of (p.costs||[]).entries()) await client.query(
    `insert into project_costs(project_id,legacy_key,source_type,category,description,budget_amount,actual_amount,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [projectId,text(x.id||i),text(x.sourceType),text(x.category),text(x.description),n(x.budgetAmt),n(x.actualAmt),JSON.stringify(x)]);
}

async function upsertEstimate(client,companyId,e){
  const scope=e.customerScope||{};
  const r=await client.query(
    `insert into estimates(company_id,legacy_id,estimate_number,title,project_class,status,markup,tax_rate,residential_summary,project_scope,converted,archived,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     on conflict(company_id,legacy_id) do update set
       estimate_number=excluded.estimate_number,title=excluded.title,project_class=excluded.project_class,status=excluded.status,
       markup=excluded.markup,tax_rate=excluded.tax_rate,residential_summary=excluded.residential_summary,project_scope=excluded.project_scope,
       converted=excluded.converted,archived=excluded.archived,legacy_payload=excluded.legacy_payload,updated_at=now()
     returning id`,
    [companyId,text(e.id),text(e.estNum||e.estimateNumber),text(e.client||e.title),text(e.projectClass||e.type),text(e.status),n(e.markup),n(e.taxRate),text(scope.residentialSummary||e.residentialSummary),text(scope.projectScope||e.projectScope),e.converted===true,e.archived===true,JSON.stringify(e)]);
  const id=r.rows[0].id;
  await client.query('delete from estimate_items where estimate_id=$1',[id]);
  for(const [i,x] of (e.lineItems||e.items||[]).entries()) await client.query(
    `insert into estimate_items(estimate_id,position,category,description,quantity,unit,unit_cost,total,markup,legacy_payload)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [id,i,text(x.category),text(x.desc||x.description),n(x.qty),text(x.unit),n(x.unitCost),n(x.total),n(x.markup),JSON.stringify(x)]);
}

async function main(){
  const file=process.argv[2];
  if(!file)throw new Error('Usage: node scripts/import-company-backup.js backup.json');
  const backup=JSON.parse(fs.readFileSync(file,'utf8'));
  if(backup.schemaVersion!==2)throw new Error('Expected Contractor Desk backup schemaVersion 2');
  if(!Array.isArray(backup.projects)||!Array.isArray(backup.estimates))throw new Error('Backup is missing projects or estimates');
  const pool=getPool(),client=await pool.connect();
  try{
    await client.query('begin');
    const companyId=await upsertCompany(client,backup);
    for(const p of backup.projects){const id=await upsertProject(client,companyId,p);await replaceProjectChildren(client,id,p);}
    for(const e of backup.estimates)await upsertEstimate(client,companyId,e);
    await client.query('commit');
    const counts=await pool.query(`select
      (select count(*)::int from projects where company_id=$1) projects,
      (select count(*)::int from estimates where company_id=$1) estimates,
      (select count(*)::int from project_selections ps join projects p on p.id=ps.project_id where p.company_id=$1) selections,
      (select count(*)::int from change_orders co join projects p on p.id=co.project_id where p.company_id=$1) change_orders,
      (select count(*)::int from daily_logs dl join projects p on p.id=dl.project_id where p.company_id=$1) daily_logs`,[companyId]);
    console.log(JSON.stringify({companyId,source:{projects:backup.projects.length,estimates:backup.estimates.length},postgres:counts.rows[0]},null,2));
  }catch(err){await client.query('rollback');throw err;}finally{client.release();await pool.end();}
}
main().catch(err=>{console.error(err);process.exit(1);});
