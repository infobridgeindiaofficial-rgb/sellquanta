import {dashboardRecords,estimatedFigures} from '../../server/financialSnapshot.mjs';
import {bankNetReceipts} from './bankNetReceipts.js';
import {BANK_MARKETS} from './bankPreview.js';
import {returnChargeTotals} from './returnChargeTotals.js';

// All-time read-only totals using the Dashboard's captured/fallback settlement logic.
export function bankingSummary(state,receipts) {
 const rows=BANK_MARKETS.map(marketplace=>({marketplace,estimatedCents:0,receivedCents:0,missing:0}));
 const rowFor=value=>rows.find(row=>row.marketplace.toLowerCase()===String(value||'').trim().toLowerCase());
 const archived=(state.monthCloseArchive||[]).flatMap(archive=>archive.sales||[]);
 const {sales,refunds,saleById}=dashboardRecords({...state,salesHistory:[...archived,...(state.salesHistory||[])]});
 for(const row of rows){
  const own=sales.filter(sale=>rowFor(sale.marketplace)===row);
  const ownRefunds=refunds.filter(refund=>rowFor((saleById.get(refund.saleId)||refund).marketplace)===row);
  const estimate=estimatedFigures(own,ownRefunds,state,saleById).estimated_settlement;
  row.estimatedCents=Math.round(estimate.knownAmount*100);
  row.missing=estimate.missingQuantity;
 }
 for(const receipt of bankNetReceipts(receipts)){const row=rowFor(receipt.marketplace);if(row)row.receivedCents+=receipt.amountCents;}
 rows.push({marketplace:'TOTAL',estimatedCents:rows.reduce((s,r)=>s+r.estimatedCents,0),receivedCents:rows.reduce((s,r)=>s+r.receivedCents,0),missing:rows.reduce((s,r)=>s+r.missing,0)});
 const charges=returnChargeTotals(state.returnCharges);
 return rows.map(row=>({...row,returnChargeCents:charges[row.marketplace],estimatedCents:row.missing?null:row.estimatedCents,dueCents:row.missing?null:row.estimatedCents-row.receivedCents-charges[row.marketplace]}));
}
