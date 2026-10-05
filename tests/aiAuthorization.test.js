const assert=require('assert'),http=require('http');
const {app}=require('../server');
describe('paid AI endpoint access',()=>{
 for(const path of ['/api/estimate','/api/daily-log'])it('rejects unsigned requests before provider processing at '+path,async()=>{
  const native=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Provider should never be called');};const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const result=await new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port:server.address().port,path,method:'POST',headers:{'Content-Type':'application/json'}},res=>{let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});request.on('error',reject);request.end(JSON.stringify({messages:[{role:'user',content:'ping'}]}));});assert.equal(result.status,401);assert.equal(result.body.error,'Authentication required');assert.equal(calls,0);}finally{global.fetch=native;await new Promise(r=>server.close(r));}
 });
});
