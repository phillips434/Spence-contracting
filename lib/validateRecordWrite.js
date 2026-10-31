const finance=require('../public/financial-rules');
async function validateRecordWrite(client,kind,companyId,doc,before){
 if(!['projects','estimates'].includes(kind))throw new Error('Invalid record kind');
 if(before===undefined){
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[companyId+':'+kind+':'+doc.id]);
  const r=await client.query('select legacy_payload from '+kind+' where company_id=$1 and legacy_id=$2 for update',[companyId,doc.id]);
  before=r.rows[0]?.legacy_payload||{};
 }
 if(!before.id&&(!String(doc.client||'').trim()||!String(doc.type||'').trim()))throw new Error('Client name and project type are required');
 if(kind==='projects')finance.reconcileApprovals(doc,before);
 finance.validate(kind,doc,before);
 return doc;
}
module.exports={validateRecordWrite};
