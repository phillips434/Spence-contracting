const {canonical}=require('./legacySerialization');
const {transact,saveProjectDocument,saveEstimateDocument}=require('./documentStore');
function applyRecordPatch(current,patch,expected){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid record patch');
 if(expected!==undefined&&(!expected||typeof expected!=='object'||Array.isArray(expected)))throw new Error('Invalid save precondition');
 const next=JSON.parse(JSON.stringify(current));
 for(const [key,value] of Object.entries(patch)){
  const parts=key.split('.');
  if(parts.some(part=>!part||['__proto__','constructor','prototype'].includes(part)))throw new Error('Invalid field path');
  if(expected&&Object.prototype.hasOwnProperty.call(expected,key)&&!['updatedAt','updatedByUid'].includes(key)){
   const check=expected[key];if(!check||typeof check.exists!=='boolean')throw new Error('Invalid save precondition');
   let at=current,exists=true;for(const part of parts){if(!at||typeof at!=='object'||!Object.prototype.hasOwnProperty.call(at,part)){exists=false;at=undefined;break;}at=at[part];}
   if((exists!==check.exists||canonical(at)!==canonical(check.value))&&canonical(at)!==canonical(value)){
    const error=new Error('Another person changed '+key+'. Reload the record before saving again.');error.status=409;throw error;
   }
  }
  let at=next;for(const part of parts.slice(0,-1)){if(!at[part]||typeof at[part]!=='object'||Array.isArray(at[part]))at[part]={};at=at[part];}at[parts.at(-1)]=value;
 }
 return next;
}
async function patchRecord(kind,companyId,id,patch,expected){
 if(!['projects','estimates'].includes(kind))throw new Error('Invalid record kind');
 return transact(async client=>{
  const row=(await client.query('select legacy_payload from '+kind+' where company_id=$1 and legacy_id=$2 for update',[companyId,id])).rows[0];
  if(!row){const error=new Error('Record not found');error.status=404;throw error;}
  const document={...applyRecordPatch(row.legacy_payload,patch,expected),id};
  if(kind==='projects')await saveProjectDocument(client,companyId,document);else await saveEstimateDocument(client,companyId,document);
  return document;
 });
}
module.exports={applyRecordPatch,patchRecord};
