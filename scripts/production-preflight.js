const fs=require("fs"),assert=require("node:assert/strict"),{getPool}=require("./db/postgres");
(async()=>{
const port=Number(process.env.SMTP_PORT||465);
const t=require("nodemailer").createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:15000});
await t.verify();t.close();console.log("SMTP authentication verified");
const pool=getPool(),c=await pool.connect();
try{
await c.query("BEGIN");
assert.equal((await c.query("select current_database() as db")).rows[0].db,"railway");
assert(process.env.CD_OWNER_UID,"Owner workspace configuration missing");
const owner=await c.query("select u.id from users u join company_memberships m on m.user_id=u.id join companies co on co.id=m.company_id where u.firebase_uid=$1 and co.legacy_owner_uid=$1 and m.role='owner' and m.status='active' and u.email is not null and length(trim(u.email))>3",[process.env.CD_OWNER_UID]);assert.equal(owner.rowCount,1,"Existing owner email or membership missing");
await c.query("LOCK TABLE projects, estimates IN SHARE MODE");
const sql="select (select count(*)::int from projects) as projects,(select count(*)::int from estimates) as estimates,(select md5(string_agg(row_to_json(p)::text,'' order by p.id)) from projects p) as project_hash,(select md5(string_agg(row_to_json(e)::text,'' order by e.id)) from estimates e) as estimate_hash";
const before=(await c.query(sql)).rows[0];assert(before.projects>0&&before.estimates>0,"Production workspace unexpectedly empty");
console.log("Current production records:",before.projects,before.estimates);
await c.query(fs.readFileSync("db/migrations/009_independent_auth.sql","utf8"));
await c.query(fs.readFileSync("db/migrations/010_signup_alerts.sql","utf8"));
await c.query("create table if not exists schema_migrations(filename text primary key,applied_at timestamptz not null default now())");
await c.query("insert into schema_migrations(filename) values($1) on conflict(filename) do nothing",["009_independent_auth.sql"]);
await c.query("insert into schema_migrations(filename) values($1) on conflict(filename) do nothing",["010_signup_alerts.sql"]);
const after=(await c.query(sql)).rows[0];assert.deepEqual(after,before);
await c.query("COMMIT");console.log("Auth schema ready; projects and estimates unchanged:",before.projects,before.estimates);
}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();await pool.end();}
})().catch(e=>{console.error("Production preflight failed:",e.code||e.name,e.message);process.exit(1)});
