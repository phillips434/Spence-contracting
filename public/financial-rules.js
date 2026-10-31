(function(root){
  'use strict';
  const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
  function number(value,label,options={}){
    if(value===''||value==null)return options.required?fail(label+' is required'):0;
    const n=Number(typeof value==='string'?value.replace(/,/g,''):value);
    if(!Number.isFinite(n))fail(label+' must be a valid number');
    if(options.min!=null&&n<options.min)fail(label+' must be at least '+options.min);
    return n;
  }
  function fail(message){throw new Error(message);}
  function contact(value,kind){
    if(!value)return;
    if(kind==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))fail('Enter a valid email address');
    if(kind==='phone'&&(!/^[+\d\s().-]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(value)||value.replace(/\D/g,'').length<7||value.replace(/\D/g,'').length>18))fail('Enter a valid phone number');
  }
  function dates(start,end,label='End date'){if(start&&end&&end<start)fail(label+' cannot be before the start date');}
  function line(item){
    if(!String(item.desc||item.description||'').trim())fail('Line item description is required');
    const qty=number(item.qty,'Quantity',{min:0}),cost=number(item.unitCost,'Unit cost'),total=number(item.total,'Line cost'),markup=number(item.markup,'Markup',{min:0});
    if(item.isCredit){if(total>0||cost>0||markup!==0)fail('Credits must be negative with zero markup');}
    else if(cost<0||total<0)fail('Use an explicit credit line for negative amounts');
    if(qty<0)fail('Quantity cannot be negative');
  }
  function changed(a,b){return JSON.stringify(a)!==JSON.stringify(b);}
  function validate(kind,doc,before={}){
    const check=(key,fn)=>{if(changed(doc[key],before[key]))fn(doc[key]);};
    check('client',v=>{if(!String(v||'').trim())fail('Client name is required');});
    check('type',v=>{if(!String(v||'').trim())fail('Project type is required');});
    for(const key of ['clientEmail','companyEmail'])check(key,v=>contact(v,'email'));
    for(const key of ['clientPhone','companyPhone'])check(key,v=>contact(v,'phone'));
    if(changed(doc.startDate,before.startDate)||changed(doc.endDate,before.endDate))dates(doc.startDate,doc.endDate);
    for(const key of kind==='projects'?['budget','spent','clientTotal']:['markup','tax'])check(key,v=>number(v,key,{min:0}));
    if(kind==='estimates'){
      if(changed(doc.date,before.date)||changed(doc.validUntil,before.validUntil))dates(doc.date,doc.validUntil,'Valid-until date');
      const old=before.lineItems||[];(doc.lineItems||[]).forEach((item,i)=>{if(changed(item,old[i]))line(item);});
    }else{
      for(const [field,budget,actual] of [['scopeItems','budget','actual'],['choices','budgetAmt','actualAmt'],['costs','budgetAmt','actualAmt']]){
        const old=before[field]||[];
        (doc[field]||[]).forEach((item,i)=>{if(changed(item,old[i])){number(item[budget],'Budget',{min:0});number(item[actual],'Actual cost',{min:0});dates(item.start,item.end);contact(item.assignPhone,'phone');contact(item.assignEmail,'email');}});
      }
      (doc.paymentMilestones||[]).forEach((m,i)=>{if(changed(m,(before.paymentMilestones||[])[i])){if(!String(m.name||m.label||'').trim())fail('Milestone name is required');number(m.amount,'Invoice amount',{min:0});
        if(m.lineItems?.length&&changed(m.lineItems,(before.paymentMilestones||[])[i]?.lineItems)){
          let cents=0;for(const item of m.lineItems){if(!String(item.desc||'').trim())fail('Invoice line description is required');const amount=number(item.amount,'Invoice line amount');if(amount<0&&!item.isCredit)fail('Negative invoice amounts require a credit line');if(item.isCredit&&amount>0)fail('Credit amounts cannot be positive');cents+=Math.round(amount*100);}
          if(cents!==Math.round(Number(m.amount)*100))fail('Invoice line items must total the invoice amount');
        }
      }});
    }
    for(const field of ['scopeItems','choices','costs','paymentMilestones','lineItems','changeOrders','dailyLogs','notesLog']){
      const ids=(doc[field]||[]).map(x=>x.id).filter(Boolean);if(new Set(ids).size!==ids.length)fail('Duplicate '+field+' identifiers. Reload before saving');
    }
    return doc;
  }
  function approvedAmount(co){return number(co.clientAmount!=null?co.clientAmount:co.budgetImpact,'Change order amount');}
  function reconcileApprovals(doc,before){
    const old=before.changeOrders||[];
    const newlyApproved=(doc.changeOrders||[]).filter(co=>co.status==='Approved'&&!old.some(prior=>String(prior.id||'')===String(co.id||'')&&prior.status==='Approved'));
    for(const prior of old.filter(x=>x.status==='Approved')){
      const current=(doc.changeOrders||[]).find(x=>String(x.id||'')===String(prior.id||''));
      if(!current||current.status!=='Approved'||approvedAmount(current)!==approvedAmount(prior))fail('Approved change orders cannot be removed or repriced. Add a credit change order.');
    }
    if(!newlyApproved.length)return doc;
    const amount=round(newlyApproved.reduce((a,co)=>a+approvedAmount(co),0));
    const existingBudget=Number(before.budget)||0;
    doc.budget=round(existingBudget+amount);
    const originalContract=before.clientTotal!=null?Number(before.clientTotal):before.estimateTotal!=null?Number(before.estimateTotal):null;
    if(originalContract!=null)doc.clientTotal=round(originalContract+amount);
    doc.paymentMilestones=doc.paymentMilestones||[];doc.scopeItems=doc.scopeItems||[];
    for(const co of newlyApproved){
      if(!co.id)fail('Change order identifier is required');
      co.clientAmount=approvedAmount(co);
      if(!doc.paymentMilestones.some(m=>String(m.coId||'')===String(co.id)))doc.paymentMilestones.push({id:'co-payment-'+co.id,coId:co.id,name:'Change Order: '+co.title,amount:co.clientAmount,paid:false,isCO:true,dueImmediately:true,dueDate:new Date().toISOString().slice(0,10)});
      if(!doc.scopeItems.some(x=>String(x.coId||'')===String(co.id)||x.desc==='[CO] '+co.title))doc.scopeItems.push({id:'co-scope-'+co.id,coId:co.id,desc:'[CO] '+co.title,budget:co.clientAmount,actual:0,complete:'Not Started',category:'Change Order'});
    }
    return doc;
  }
  function project(p){
    const costBudget=number(p.budget,'Budget'),spent=number(p.spent,'Spent');
    const scheduled=round((p.paymentMilestones||[]).reduce((a,m)=>a+(Number(m.amount)||0),0));
    const paid=round((p.paymentMilestones||[]).filter(m=>m.paid===true||m.isPaid===true||['paid','complete','completed'].includes(String(m.status||'').toLowerCase())).reduce((a,m)=>a+(Number(m.amount)||0),0));
    const contract=p.clientTotal!=null?number(p.clientTotal,'Contract total'):p.estimateTotal!=null?number(p.estimateTotal,'Contract total'):null;
    return {budget:costBudget,spent,remaining:round(costBudget-spent),budgetPercent:costBudget>0?Math.round(spent/costBudget*100):null,contract,scheduled,paid,balance:contract==null?round(scheduled-paid):round(contract-paid),scheduleGap:contract==null?null:round(contract-scheduled)};
  }
  const api={round,number,contact,dates,line,validate,project,approvedAmount,reconcileApprovals};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CDFinance=api;
})(typeof globalThis!=='undefined'?globalThis:this);
