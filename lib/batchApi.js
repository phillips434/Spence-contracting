const {transact,saveProjectDocument,saveEstimateDocument}=require('./documentStore');
async function saveBatch(companyId,operations){
  if(!Array.isArray(operations)||operations.length>500)throw new Error('Invalid batch');
  for(const op of operations)if(!['projects','estimates'].includes(op.kind)||!['set','update'].includes(op.method)||!op.id||!op.data||typeof op.data!=='object'||Array.isArray(op.data))throw new Error('Invalid batch operation');
  return transact(async client=>{
    for(const op of operations){
      let document=op.data;
      if(op.method==='update'||op.merge){const row=(await client.query('select legacy_payload from '+op.kind+' where company_id=$1 and legacy_id=$2 for update',[companyId,op.id])).rows[0];if(!row&&op.method==='update')throw new Error('Record not found');document={...row?.legacy_payload,...op.data};}
      document={...document,id:op.id};
      if(op.kind==='projects')await saveProjectDocument(client,companyId,document);else await saveEstimateDocument(client,companyId,document);
    }
  });
}
function installBatchRoutes(app){app.post('/api/data/batch',async(req,res)=>{try{await saveBatch(req.cdCompany.id,req.body.operations);res.json({ok:true});}catch(e){res.status(400).json({ok:false,error:e.message});}});}
module.exports={saveBatch,installBatchRoutes};
