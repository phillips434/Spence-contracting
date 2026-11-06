// Match the browser's line-item markup/tax calculation, then compare cents.
function estimateScheduleState(estimate){
  const rows=estimate.paymentMilestones||[];
  // Round each marked-up line before summing, exactly as the estimate UI does.
  let clientTotal=(estimate.lineItems||[]).reduce((sum,item)=>{
    const cost=parseFloat(item.total)||((parseFloat(item.qty)||1)*(parseFloat(item.unitCost)||0));
    const markup=parseFloat(item.markup)||0;
    return sum+Math.round((cost*(1+markup/100)+Number.EPSILON)*100)/100;
  },0);
  let taxAmount=clientTotal*((parseFloat(estimate.tax)||0)/100);
  clientTotal=Math.round(clientTotal*100)/100;
  taxAmount=Math.round(taxAmount*100)/100;
  const grandTotal=Math.round((clientTotal+taxAmount)*100)/100;
  const total=Math.round(grandTotal*100);
  const invalid=rows.some(row=>!row||row.amount==null||String(row.amount).trim()===''||!Number.isFinite(Number(row.amount))||Number(row.amount)<0);
  const scheduled=rows.reduce((sum,row)=>sum+Math.round((Number(row?.amount)||0)*100),0);
  return {mismatch:!!rows.length&&(invalid||scheduled!==total),invalid,total:total/100,scheduled:scheduled/100,difference:(total-scheduled)/100};
}
module.exports={estimateScheduleState};
