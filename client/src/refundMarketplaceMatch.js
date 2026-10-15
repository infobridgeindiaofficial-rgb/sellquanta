const key=value=>String(value??'').trim().toLowerCase();
export function refundMarketplaceMatch(refund,charges=[]) {
 if(refund.refundReason!=='Customer Return')return {status:refund.refundReason||'Not classified',cents:null,badge:'tag'};
 const seen=new Set();let cents=0,matched=false;
 for(const charge of charges){
  if(charge.status!=='Confirmed'||!refund.orderId||key(charge.orderId)!==key(refund.orderId)||key(charge.marketplace)!==key(refund.marketplace)||!Number.isSafeInteger(charge.amountCents)||charge.amountCents<0)continue;
  const identity=charge.duplicateKey||charge.id;if(!identity||seen.has(identity))continue;seen.add(identity);matched=true;cents+=charge.amountCents;
 }
 return matched?{status:'Matched & Confirmed',cents,badge:'saved'}:{status:'Awaiting Marketplace Match',cents:null,badge:'warn'};
}
