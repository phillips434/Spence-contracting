// Match the browser's line-item markup/tax calculation, then compare cents.
function estimateScheduleState(estimate){
  const rows=estimate.paymentMilestones||[];
  const clientTotal=(estimate.lineItems||[]).reduce((sum,item)=>sum+(parseFloat(item.total)||0)*(1+(parseFloat(item.markup)||0)/100),0);
  const total=Math.round((clientTotal+clientTotal*((parseFloat(estimate.tax)||0)/100))*100);
  const invalid=rows.some(row=>!row||row.amount==null||String(row.amount).trim()===''||!Number.isFinite(Number(row.amount))||Number(row.amount)<0);
  const scheduled=rows.reduce((sum,row)=>sum+Math.round((Number(row?.amount)||0)*100),0);
  return {mismatch:!!rows.length&&(invalid||scheduled!==total),invalid,total:total/100,scheduled:scheduled/100,difference:(total-scheduled)/100};
}
module.exports={estimateScheduleState};
