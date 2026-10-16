import {reportRecords} from '../../server/reports.mjs';
const market=v=>['Amazon','Flipkart','Meesho'].find(m=>m.toLowerCase()===String(v||'').trim().toLowerCase());
export const saleDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s.date||'')?s.date:Number.isFinite(Date.parse(s.createdAt||''))?new Date(s.createdAt).toISOString().slice(0,10):'';
export const refundDay=r=>saleDay({date:r.refundDate,createdAt:r.refundedAt});
export function dashboardRecords(state){const {sales,returns:refunds}=reportRecords(state);return {sales,refunds,saleById:new Map(sales.map(s=>[s.id,s]))};}
// Same active-receipt contract as released Banking, including versioned corrections/deletions.
export const bankNetReceipts=(rows=[])=>rows.filter(r=>!r.deletedAt);
export const purchaseTotalCents=p=>Number.isSafeInteger(p.totalCents??p.amountCents)?(p.totalCents??p.amountCents):null;
const total=values=>{if(values.some(n=>!Number.isSafeInteger(n)))throw Error('A saved amount is invalid; reconcile the source record before reporting.');const n=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(n))throw Error('The selected totals exceed the supported monetary range.');return n;};
export function bankingSummary(state,receipts=[]){
 const {sales}=reportRecords(state),active=bankNetReceipts(receipts);
 const rows=['Amazon','Flipkart','Meesho'].map(marketplace=>{const salesCents=total(sales.filter(s=>market(s.marketplace)===marketplace).map(s=>Math.round(Number(s.saleAmount||0)*100))),receivedCents=total(active.filter(r=>r.marketplace===marketplace).map(r=>r.amountCents));return {marketplace,salesCents,receivedCents,dueCents:total([salesCents,-receivedCents])};});
 rows.push({marketplace:'TOTAL',salesCents:total(rows.map(r=>r.salesCents)),receivedCents:total(rows.map(r=>r.receivedCents)),dueCents:total(rows.map(r=>r.dueCents))});return rows;
}
