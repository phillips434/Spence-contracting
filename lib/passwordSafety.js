const {createHash}=require('node:crypto');
async function checkPassword(password,fetcher=global.fetch){
 const digest=createHash('sha1').update(password).digest('hex').toUpperCase();
 let response;
 try{response=await fetcher('https://api.pwnedpasswords.com/range/'+digest.slice(0,5),{headers:{'Add-Padding':'true'},signal:AbortSignal.timeout(5000)});}catch(e){throw new Error('Password safety check is unavailable. Please try again shortly.');}
 if(!response.ok)throw new Error('Password safety check is unavailable. Please try again shortly.');
 const match=(await response.text()).split(/\r?\n/).find(line=>line.split(':')[0]===digest.slice(5));
 if(match&&Number(match.split(':')[1])>0)throw new Error('This password has appeared in a data breach. Choose a different passphrase.');
}
module.exports={checkPassword};
