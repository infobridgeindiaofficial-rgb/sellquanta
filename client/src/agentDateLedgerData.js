import {stockRecords,saleStockCents,refundStockCents} from '../../server/stockCost.mjs';
import {saleDay,refundDay,inDateRange} from './dashboardStats.js';
export function agentDateLedger(state,agentId,from,to){
 const {sales,refunds,saleById}=stockRecords(state),rows=[];
 for(const sale of sales.filter(s=>s.agentId===agentId)){const cents=saleStockCents(sale);rows.push({id:'sale:'+sale.id,date:saleDay(sale),marketplace:sale.marketplace,orderId:sale.orderId,product:sale.productName,qty:Number(sale.qty||0),unitCost:cents===null?null:cents/100/Number(sale.qty||1),stockCost:cents===null?null:cents/100,type:'Sale',amount:cents===null?null:cents/100});}
 for(const refund of refunds.filter(r=>(r.agentId||saleById.get(r.saleId)?.agentId)===agentId)){const sale=saleById.get(refund.saleId),cents=refundStockCents(refund,saleById);rows.push({id:'refund:'+refund.id,date:refundDay(refund),marketplace:refund.marketplace||sale?.marketplace,orderId:refund.orderId||sale?.orderId,product:refund.productName||sale?.productName,qty:Number(refund.qty||0),unitCost:cents===null?null:cents/100/Number(refund.qty||1),stockCost:cents===null?null:-cents/100,type:'Refund',amount:cents===null?null:-cents/100});}
 const seen=new Set();for(const entry of [...(state.ledger||[]),...(state.monthCloseArchive||[]).flatMap(a=>a.ledger||[])]){if(entry.agentId!==agentId||!['PAYMENT','SETTLEMENT'].includes(entry.type)||seen.has(entry.id))continue;seen.add(entry.id);rows.push({id:'credit:'+entry.id,date:saleDay(entry),marketplace:entry.marketplace||'',orderId:'',product:'',qty:0,unitCost:null,stockCost:0,type:'Wallet Credit',amount:Number(entry.amount||0)});}
 const selected=from&&to&&from<=to?rows.filter(r=>inDateRange(r.date,from,to)).sort((a,b)=>b.date.localeCompare(a.date)):[];
 const sold=selected.filter(r=>r.type==='Sale').reduce((s,r)=>s+r.qty,0),refunded=selected.filter(r=>r.type==='Refund').reduce((s,r)=>s+r.qty,0);
 const cost=selected.some(r=>r.stockCost===null)?null:selected.reduce((s,r)=>s+Math.round(r.stockCost*100),0)/100,credits=selected.filter(r=>r.type==='Wallet Credit').reduce((s,r)=>s+Math.round(r.amount*100),0)/100;
 return {rows:selected,sold,refunded,net:sold-refunded,cost,credits,balance:cost===null?null:Math.round((cost-credits)*100)/100};
}
