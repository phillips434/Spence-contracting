// Synthetic fixture bootstrap for the isolated staging database only.
// Production start remains node server.js. No fixture route or authentication bypass exists.
const fs=require('fs'),path=require('path');
async function main(){
 if(process.env.APP_ENVIRONMENT!=='staging'||process.env.PGDATABASE!=='contractor_beta'||!process.env.CD_QA_PASSWORD)throw Error('Isolated staging configuration required');
 const {getPool}=require('../db/postgres'),pool=getPool();
 const actual=(await pool.query('select current_database() as name')).rows[0].name;
 if(actual!=='contractor_beta')throw Error('Refusing to bootstrap another database');
 await pool.query('create table if not exists schema_migrations(filename text primary key,applied_at timestamptz not null default now())');
 for(const filename of fs.readdirSync(path.join(__dirname,'../db/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if((await pool.query('select 1 from schema_migrations where filename=$1',[filename])).rowCount)continue;
  const client=await pool.connect();try{await client.query('begin');await client.query(fs.readFileSync(path.join(__dirname,'../db/migrations',filename),'utf8'));await client.query('insert into schema_migrations(filename) values($1)',[filename]);await client.query('commit');}catch(e){await client.query('rollback');throw e;}finally{client.release();}
 }
 const {saveSelf}=require('../lib/identityApi'),{passwordHash}=require('../lib/authApi');
 const owner='cd_beta_fixture_owner',email='owner@contractor-beta.invalid';
 if(!(await pool.query('select 1 from users where firebase_uid=$1',[owner])).rowCount)await saveSelf({cdUser:{uid:owner,email,createdAt:Date.now()}},{name:'Synthetic QA Owner',company:'Synthetic Beta QA — No Customer Data',email,plan:'trial',agreedToTerms:true,agreedAt:Date.now()});
 await pool.query('insert into auth_accounts(uid,email,password_hash) values($1,$2,$3) on conflict(uid) do update set password_hash=excluded.password_hash',[owner,email,await passwordHash(process.env.CD_QA_PASSWORD)]);
 const cid=(await pool.query('select id from companies where legacy_owner_uid=$1',[owner])).rows[0].id;
 const {transact,saveProjectDocument,saveEstimateDocument}=require('../lib/documentStore');
 await transact(async client=>{
  if(!(await client.query('select 1 from projects where company_id=$1',[cid])).rowCount)await saveProjectDocument(client,cid,{id:'beta-fixture-project',client:'NONBINDING QA PROJECT',userId:owner,ownerUid:owner,type:'Synthetic Kitchen Remodel',status:'In Progress',jobNum:'JOB-0001',budget:5000,spent:100,scopeItems:[{desc:'Synthetic cabinet installation',budget:500,actual:0,complete:'Not Started',category:'Cabinets'}],choices:[{item:'Synthetic tile',category:'Tile',status:'Pending'}],costs:[{description:'Synthetic test cost',actualAmt:100,category:'Materials'}],dailyLogs:[],punchList:[{text:'Synthetic touch-up',done:false}],notesLog:[],changeOrders:[],paymentMilestones:[]});
  if(!(await client.query('select 1 from estimates where company_id=$1',[cid])).rowCount)await saveEstimateDocument(client,cid,{id:'beta-fixture-estimate',client:'NONBINDING QA ESTIMATE',userId:owner,ownerUid:owner,type:'Synthetic Kitchen',status:'Draft',projectClass:'residential',estNum:'EST-0001',lineItems:[{desc:'Synthetic material',category:'Materials',qty:10,unit:'ea',unitCost:50,total:500,markup:20}],residentialSummary:'Synthetic fixture only.',projectScope:'Synthetic kitchen work.',workIncluded:['Synthetic material'],conditionsAssumptions:[],contractText:'NONBINDING AUTOMATED FIXTURE. No offer, contract, payment obligation or actual client signature.'});
 });
 console.log('Isolated staging schema and synthetic fixtures ready.');
 require('../server').app.listen(process.env.PORT||5000,'0.0.0.0',()=>console.log('Staging application listening.'));
}
main().catch(e=>{console.error('Staging startup failed:',e.message);process.exitCode=1;});
