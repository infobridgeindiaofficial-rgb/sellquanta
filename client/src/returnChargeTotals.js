export const RETURN_MARKETS=['Amazon','Flipkart','Meesho'];
export function returnChargeTotals(records=[]) {
 const totals=Object.fromEntries(RETURN_MARKETS.map(m=>[m,0])),seen=new Set();
 for(const row of records){const key=row.duplicateKey||row.id;if(key&&seen.has(key))continue;if(key)seen.add(key);
  if(row.status==='Confirmed'&&RETURN_MARKETS.includes(row.marketplace)&&Number.isSafeInteger(row.amountCents)&&row.amountCents>0)totals[row.marketplace]+=row.amountCents;
 }
 totals.TOTAL=RETURN_MARKETS.reduce((sum,m)=>sum+totals[m],0);return totals;
}
