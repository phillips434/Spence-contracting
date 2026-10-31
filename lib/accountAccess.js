const OWNER_UID=process.env.CD_OWNER_UID||'L5XUqfnWrrgbAk18X36XcHDJxnz1';
function entitlement(ownerUid,profile,now=Date.now()){
  if(ownerUid===OWNER_UID)return true;
  if(!profile||['revoked','inactive'].includes(profile.status))return false;
  if(profile.plan==='paid')return !profile.subscriptionEnd||Number(profile.subscriptionEnd)>now;
  return profile.plan==='trial'&&Number(profile.trialEnd)>now;
}
function platformAdmin(req,res,next){if(req.cdUser?.uid!==OWNER_UID)return res.status(403).json({ok:false,error:'Administrator access required'});next();}
module.exports={entitlement,platformAdmin};
