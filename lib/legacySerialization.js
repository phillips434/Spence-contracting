const {createHash}=require('node:crypto');
function decodeValue(v){
  if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decodeValue(x)]));
  if(v.arrayValue)return (v.arrayValue.values||[]).map(decodeValue);
  for(const k of ['stringValue','booleanValue','timestampValue','nullValue'])if(k in v)return v[k];
  if('integerValue' in v)return Number(v.integerValue);
  if('doubleValue' in v)return v.doubleValue;
  return v;
}
function decodeDocument(d){return {id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decodeValue(v)]))};}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(canonical(v)).digest('hex');}
module.exports={decodeValue,decodeDocument,canonical,digest};
