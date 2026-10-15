const normalized=value=>String(value??'').trim().toLowerCase();

export function confirmedPeriodCharges(records=[],options={}) {
 const seen=new Set();
 return records.filter(row=>{
  if(row.status!=='Confirmed'||!row.id||!Number.isSafeInteger(row.amountCents)||row.amountCents<=0)return false;
  const day=String(row.date||'').slice(0,10);
  if(options.fromDate||options.toDate){if(!day||(options.fromDate&&day<options.fromDate)||(options.toDate&&day>options.toDate))return false;}
  else if(options.month&&day.slice(0,7)!==options.month)return false;
  const key=row.duplicateKey||row.id;if(seen.has(key))return false;seen.add(key);return true;
 });
}

// Charge date is the expense period; company attribution requires a unique sale match.
export function chargeCompany(row,sales,agents=[]) {
 if(!row.orderId)return null;
 const matches=sales.filter(sale=>normalized(sale.orderId)===normalized(row.orderId)&&normalized(sale.marketplace)===normalized(row.marketplace)
  &&(!row.sku||normalized(sale.marketplaceSku)===normalized(row.sku)));
 const companies=new Set(matches.map(sale=>sale.companyId||agents.find(agent=>agent.id===sale.agentId)?.companyId||''));
 return companies.size===1&&![...companies].includes('')?[...companies][0]:null;
}

export function adjustProfitEstimate(estimate,charges) {
 const cents=charges.reduce((sum,row)=>sum+row.amountCents,0),expense=cents/100;
 return {...estimate,amount:estimate.amount===null?null:(Math.round(estimate.amount*100)-cents)/100,
  knownAmount:(Math.round(estimate.knownAmount*100)-cents)/100,returnChargeAmount:expense};
}
