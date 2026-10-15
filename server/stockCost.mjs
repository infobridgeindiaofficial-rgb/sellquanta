import {dashboardRecords} from './financialSnapshot.mjs';
export function stockRecords(state){return dashboardRecords({...state,salesHistory:[...(state.monthCloseArchive||[]).flatMap(a=>a.sales||[]),...(state.salesHistory||[])]});}
export function saleStockCents(sale){
 const unit=sale?.financialSnapshot?.perUnit?.cost_price;
 if(Number.isFinite(unit))return Math.round(unit*100)*Number(sale.qty||0);
 return Number.isFinite(sale?.costTotal)?Math.round(sale.costTotal*100):null;
}
export function refundStockCents(refund,saleById){
 const sale=saleById.get(refund.saleId),cost=saleStockCents(sale);
 if(cost!==null&&Number(sale.qty)>0)return Math.round(cost*Number(refund.qty||0)/Number(sale.qty));
 const unit=refund.financialSnapshot?.perUnit?.cost_price;
 return Number.isFinite(unit)?Math.round(unit*100)*Number(refund.qty||0):Number.isFinite(refund.costAmount)?Math.round(refund.costAmount*100):null;
}
export function stockLedgerCents(entry,state){
 if(entry.type!=='SALE')return Math.round(Number(entry.amount||0)*100);
 const {saleById,refunds}=stockRecords(state);
 const refund=refunds.find(r=>r.id===(entry.refundId||entry.referenceId));
 if(refund)return -(refundStockCents(refund,saleById)??0);
 const sale=saleById.get(entry.referenceId);
 if(sale)return saleStockCents(sale)??Math.round(Number(entry.amount||0)*100);
 // An unlinked refund cannot safely use its selling-amount reversal as stock cost.
 return entry.kind==='REFUND_REVERSAL'?0:Math.round(Number(entry.amount||0)*100);
}
