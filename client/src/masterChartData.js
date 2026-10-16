import {saleFinancials, financialMapping} from '../../server/financialSnapshot.mjs';
import {saleStockCents, refundStockCents} from '../../server/stockCost.mjs';
import {localToday} from './dashboardStats.js';
import {saleDay,refundDay,dashboardRecords,bankingSummary,bankNetReceipts,purchaseTotalCents} from './masterChartCompatibility.js';
import {confirmedPeriodCharges} from './returnChargeProfit.js';


import {agentWalletTotals} from './wallet.js';


export const MARKETS=['Amazon','Flipkart','Meesho'];
export const norm=v=>String(v??'').trim().toLowerCase();
export const canonicalMarket=v=>MARKETS.find(m=>norm(m)===norm(v))||String(v||'Unknown');
export const moneyCents=v=>typeof v==='number'&&Number.isFinite(v)&&Number.isSafeInteger(Math.round(v*100))?Math.round(v*100):null;
export const sumKnown=values=>{if(values.some(v=>!Number.isSafeInteger(v)))return null;const total=values.reduce((s,v)=>s+v,0);return Number.isSafeInteger(total)?total:null;};
export const ratio=(a,b)=>a===null||b===null||b<=0?null:a/b*100;
export const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&!Number.isNaN(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const unique=rows=>[...new Map(rows.map((r,i)=>[r.id||JSON.stringify(r)||i,r])).values()];
const unitContribution=(snapshot,key,qty)=>{const unit=moneyCents(snapshot.perUnit?.[key]);const value=unit===null?null:unit*qty;return Number.isSafeInteger(value)?value:null;};
const shift=(day,n)=>{const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+n);return localToday(d);};
export function periodFor(preset='This Month',today=localToday()) {
  const year=today.slice(0,4),month=today.slice(0,7);
  if(preset==='Today')return {from:today,to:today};
  if(preset==='Yesterday')return {from:shift(today,-1),to:shift(today,-1)};
  if(preset==='Last 7 Days')return {from:shift(today,-6),to:today};
  if(preset==='This Year')return {from:year+'-01-01',to:today};
  if(preset==='Last Month'){const to=shift(month+'-01',-1);return {from:to.slice(0,7)+'-01',to};}
  return {from:month+'-01',to:today};
}
export function previousPeriod({from,to}){
  if(!validDate(from)||!validDate(to)||from>to)return null;
  const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  return {from:shift(from,-days),to:shift(from,-1)};
}
export function bucketDate(day,grain='daily'){
  if(!validDate(day))return 'Undated';
  if(grain==='yearly')return day.slice(0,4);
  if(grain==='monthly')return day.slice(0,7);
  if(grain==='weekly'){const n=new Date(day+'T12:00:00').getDay();return shift(day,-((n+6)%7));}
  return day;
}
export const METRICS={
  gross:{label:'Gross Sales',unit:'money',definition:'Saved sale invoice amounts before refunds.'},
  revenue:{label:'Net Sales',unit:'money',definition:'Gross invoice sales minus saved refund amounts, each on its own transaction date.'},
  orders:{label:'Total Orders',unit:'count',definition:'Distinct company + marketplace + order IDs among sales. Missing order IDs use sale IDs.'},
  sold:{label:'Gross Units Sold',unit:'count',definition:'Sale quantities before all refund classifications.'},
  net:{label:'Net Units Sold',unit:'count',definition:'Gross units minus refunded units (Customer Return, RTO, Cancelled and unclassified).'},
  profit:{label:'Estimated Profit',unit:'money',definition:'Captured or uniquely mapped per-unit estimated profit, net of refunds and confirmed extra charges. Missing values remain unavailable.'},
  margin:{label:'Profit Margin %',unit:'percent',definition:'Estimated profit / net invoice revenue × 100; unavailable for nonpositive revenue.'},
  returnRate:{label:'Customer Return %',unit:'percent',definition:'Customer Returned Units / Gross Sold Units × 100. RTO and Cancelled excluded. Different transaction periods can exceed 100%.'},
  rto:{label:'RTO Quantity',unit:'count',definition:'Refund quantities explicitly classified RTO.'},
  customer:{label:'Customer Returned Units',unit:'count',definition:'Saved refund quantities explicitly classified Customer Return.'},
  unclassified:{label:'Unclassified Refund Units',unit:'count',definition:'Saved refund quantities without a recorded return classification.'},
  cancelled:{label:'Cancelled Quantity',unit:'count',definition:'Refund quantities explicitly classified Cancelled.'},
  extra:{label:'Confirmed Return Extra Charges',unit:'money',definition:'Deduplicated confirmed saved charges by expense date, including unmatched charges in unscoped totals.'},
  settlement:{label:'Estimated Settlement',unit:'money',definition:'Captured or uniquely mapped estimated settlement per unit, less refunded quantities. Not bank cash.'},
  refund:{label:'Refund Amount',unit:'money',definition:'Saved customer refund amounts, all classifications; missing amounts are not inferred.'},
  stock:{label:'Net Product Stock Cost',unit:'money',definition:'Original saved sale stock costs minus original-cost refund reversals. Returned stock cost is not labelled a permanent loss.'},
  aov:{label:'Average Order Value',unit:'money',definition:'Gross sales / distinct sale orders.'},
  received:{label:'Bank Received',unit:'money',definition:'Released active bank settlements (deleted records excluded); cash date, independent of sales allocation.'},
  due:{label:'Reference Difference',unit:'money',definition:'Released all-time Banking: gross recorded sales minus active bank receipts; not profit/loss or unpaid settlement. Dimension allocations unavailable.'}
};
export function metricText(value,metric){
  if(value===null||value===undefined||!Number.isFinite(value))return 'Not Available';
  const unit=METRICS[metric]?.unit;
  return unit==='money'?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value/100):unit==='percent'?value.toFixed(2)+'%':new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(value);
}

// All rows are new objects. No mutation, persistence, inferred ownership or amount guessing.
export function masterFacts(state){
  const archives=state.monthCloseArchive||[];
  const source={...state,salesHistory:unique([...(state.salesHistory||[]),...archives.flatMap(a=>a.sales||[])]),refunds:unique([...(state.refunds||[]),...archives.flatMap(a=>a.refunds||[])]),returnCharges:unique(state.returnCharges||[]).map(c=>({...c,marketplace:canonicalMarket(c.marketplace)}))};
  const {sales,refunds,saleById}=dashboardRecords(source);
  const products=state.products||[],companies=state.companies||[],agents=state.agents||[];
  function dimensions(record){
    const companyId=record.companyId||agents.find(a=>a.id===record.agentId)?.companyId||'';
    let product=products.find(p=>p.id===record.productId);
    if(!product&&record.warehouseProductCode){const found=products.filter(p=>norm(p.sku)===norm(record.warehouseProductCode));if(found.length===1)product=found[0];}
    const mapping=financialMapping(state.productMaster,{...record,companyId});
    if(!product&&mapping)product=products.find(p=>p.id===mapping.productId);
    const productId=product?.id||record.productId||'';
    return {accountId:record.accountId||'',companyId,company:companies.find(c=>c.id===companyId)?.name||'Unattributed company',agentId:record.agentId||'',agent:agents.find(a=>a.id===record.agentId)?.name||'Unattributed agent',
      marketplace:canonicalMarket(record.marketplace),productId,product:product?.name||record.productName||'Unmapped product',sku:product?.sku||record.warehouseProductCode||'',marketplaceSku:record.marketplaceSku||record.sku||'',orderId:record.orderId||''};
  }
  const zero={gross:0,refund:0,sold:0,refunded:0,customer:0,rto:0,cancelled:0,unclassified:0,profit:0,settlement:0,stock:0,extra:0};
  const facts=[],review=[];
  for(const sale of sales){const fin=saleFinancials(sale,state).snapshot,qty=Number(sale.qty||0);
    facts.push({...zero,...dimensions(sale),id:'sale:'+sale.id,sourceId:sale.id,kind:'Sale',date:saleDay(sale),sold:qty,gross:moneyCents(sale.saleAmount),profit:unitContribution(fin,'estimated_profit',qty),
      settlement:unitContribution(fin,'estimated_settlement',qty),stock:saleStockCents(sale),provenance:sale.financialSnapshot?'Captured':'Current mapping / unavailable'});
  }
  for(const refund of refunds){const sale=saleById.get(refund.saleId),record={...sale,...refund,productId:refund.productId||sale?.productId,marketplace:refund.marketplace||sale?.marketplace,agentId:refund.agentId||sale?.agentId,companyId:refund.companyId||sale?.companyId,orderId:refund.orderId||sale?.orderId},qty=Number(refund.qty||0),fin=saleFinancials(sale||record,state).snapshot;
    const field={'Customer Return':'customer',RTO:'rto',Cancelled:'cancelled'}[refund.refundReason]||'unclassified';
    const stock=refundStockCents(refund,saleById);
    facts.push({...zero,...dimensions(record),id:'refund:'+refund.id,sourceId:refund.id,kind:'Refund',reason:refund.refundReason||'Unclassified',date:refundDay(refund),refunded:qty,[field]:qty,refund:moneyCents(refund.refundAmount),
      profit:unitContribution(fin,'estimated_profit',-qty),settlement:unitContribution(fin,'estimated_settlement',-qty),stock:stock===null?null:-stock});
  }
  const charges=confirmedPeriodCharges(source.returnCharges);
  for(const charge of charges){
    const candidates=sales.filter(s=>norm(s.orderId)===norm(charge.orderId)&&!!charge.orderId&&canonicalMarket(s.marketplace)===canonicalMarket(charge.marketplace)
      &&(!charge.companyId||dimensions(s).companyId===charge.companyId)
      &&(!charge.sku||norm(s.marketplaceSku||s.sku)===norm(charge.sku)||(state.productMaster||[]).some(m=>m.companyId===dimensions(s).companyId&&canonicalMarket(m.marketplace)===canonicalMarket(s.marketplace)&&m.productId===dimensions(s).productId&&norm(m.marketplaceSku)===norm(charge.sku)))
      &&(!charge.productId||dimensions(s).productId===charge.productId)&&(!charge.warehouseProductCode||norm(dimensions(s).sku)===norm(charge.warehouseProductCode)));
    const signatures=new Set(candidates.map(s=>JSON.stringify([dimensions(s).companyId,dimensions(s).agentId,dimensions(s).productId])));
    const matched=candidates.length&&signatures.size===1&&dimensions(candidates[0]).productId;
    const dims=matched?dimensions(candidates[0]):dimensions({marketplace:charge.marketplace,orderId:charge.orderId});
    const fact={...zero,...dims,id:'charge:'+charge.id,sourceId:charge.id,kind:'Charge',date:String(charge.date||'').slice(0,10),extra:charge.amountCents,profit:-charge.amountCents,matched:!!matched};
    facts.push(fact);
    if(!matched)review.push({...fact,reviewReason:'Confirmed charge: no unique marketplace/order/SKU/company/agent match'});
  }
  for(const charge of state.returnCharges||[])if(charge.status!=='Duplicate'&&!charges.some(c=>c.id===charge.id))review.push({id:'review:'+charge.id,kind:'Charge review',...dimensions({marketplace:charge.marketplace,orderId:charge.orderId}),date:String(charge.date||'').slice(0,10),extra:Number.isSafeInteger(charge.amountCents)?charge.amountCents:null,reviewReason:'Unconfirmed, duplicate, or invalid charge excluded from financial totals'});
  for(const fact of facts)if(!validDate(fact.date)||(!fact.productId&&fact.kind!=='Charge'))review.push({...fact,reviewReason:!validDate(fact.date)?'Missing transaction date; excluded from period totals':'Missing product mapping; retained as Unmapped product'});
  return {facts,review,source};
}
export function matchesScope(f,filters){return ['marketplace','companyId','agentId','productId'].every(k=>!filters[k]||f[k]===filters[k]);}
export function filterFacts(facts,filters){return facts.filter(f=>validDate(f.date)&&(!filters.from||f.date>=filters.from)&&(!filters.to||f.date<=filters.to)&&matchesScope(f,filters));}
export function aggregateFacts(facts){
  const total={};for(const key of ['gross','refund','sold','refunded','customer','rto','cancelled','unclassified','profit','settlement','stock','extra'])total[key]=sumKnown(facts.map(f=>f[key]));
  total.revenue=total.gross===null||total.refund===null?null:total.gross-total.refund;total.net=total.sold-total.refunded;
  total.orders=new Set(facts.filter(f=>f.kind==='Sale').map(f=>JSON.stringify([f.accountId||f.agentId,f.marketplace,f.date,norm(f.orderId)||f.sourceId]))).size;
  total.returnRate=ratio(total.customer,total.sold);total.margin=ratio(total.profit,total.revenue);total.aov=total.gross===null||!total.orders?null:Math.round(total.gross/total.orders);
  total.events=facts.length;return total;
}
export function groupFacts(facts,dimensions){
  const groups=new Map();
  for(const f of facts){const values=dimensions.map(d=>d==='month'?f.date.slice(0,7):f[d]??''),key=JSON.stringify(values);if(!groups.has(key))groups.set(key,{key,values,facts:[]});groups.get(key).facts.push(f);}
  return [...groups.values()].map(g=>({...g,totals:aggregateFacts(g.facts)}));
}
export function inventoryFor(state,filters){
  if(filters.agentId)return null;
  // Warehouse stock is shared; no saved company/marketplace ownership is inferred.
  if(filters.companyId||filters.marketplace)return null;
  return (state.products||[]).filter(p=>p.active!==false&&(!filters.productId||p.id===filters.productId)).map(p=>({id:p.id,product:p.name,sku:p.sku,stock:typeof p.stock==='number'?p.stock:null,value:typeof p.stock==='number'&&moneyCents(p.costPrice)!==null?p.stock*moneyCents(p.costPrice):null}));
}
export function buildMasterChart(state,filters){
  if(!validDate(filters.from)||!validDate(filters.to)||filters.from>filters.to)throw Error('Select a valid date range.');
  const data=masterFacts(state),facts=filterFacts(data.facts,filters),totals=aggregateFacts(facts),priorRange=previousPeriod(filters),priorFacts=filterFacts(data.facts,{...filters,...priorRange});
  const prior=aggregateFacts(priorFacts),comparable=facts.some(f=>f.kind==='Sale')&&priorFacts.some(f=>f.kind==='Sale');
  const dimensional=!!(filters.companyId||filters.agentId||filters.productId);
  const banks=bankingSummary(data.source,state.bankSettlements||[]),bank=banks.find(r=>r.marketplace===(filters.marketplace||'TOTAL'));
  const financial={scope:filters.marketplace||'All marketplaces',estimated:dimensional?null:bank?.salesCents??null,received:dimensional?null:bank?.receivedCents??null,extra:dimensional?null:confirmedPeriodCharges(state.returnCharges).reduce((n,c)=>n+(!filters.marketplace||c.marketplace===filters.marketplace?c.amountCents:0),0),due:dimensional?null:bank?.dueCents??null,
    note:dimensional?'Not Available: bank receipts lack company, agent and product allocations.':'Released Banking basis: gross recorded sales minus active receipts, not profit/loss or automatically unpaid settlement. Confirmed charges are shown separately, not deducted again.'};
  const receipts=bankNetReceipts(state.bankSettlements||[]).filter(r=>(!filters.marketplace||canonicalMarket(r.marketplace)===filters.marketplace)&&String(r.date||'').slice(0,10)>=filters.from&&String(r.date||'').slice(0,10)<=filters.to);
  totals.received=dimensional?null:sumKnown(receipts.map(r=>Number.isSafeInteger(r.amountCents)?r.amountCents:null));
  const agents=(state.agents||[]).filter(a=>(!filters.agentId||a.id===filters.agentId)&&(!filters.companyId||a.companyId===filters.companyId)).map(a=>{
    const wallet=agentWalletTotals(state.ledger||[],a.id,state.walletResets,state);
    return {id:a.id,name:a.name,company:(state.companies||[]).find(c=>c.id===a.companyId)?.name||'Unattributed company',due:Math.round(wallet.due*100),paid:Math.round(wallet.paid*100),pending:Math.round(wallet.pending*100),scope:'Current wallet since latest reset; all dates, marketplaces and products'};
  });
  const purchases=unique(state.purchases||[]).filter(p=>String(p.date||'')>=filters.from&&String(p.date||'')<=filters.to);
  const purchaseTotal=dimensional||filters.marketplace?null:sumKnown(purchases.map(purchaseTotalCents));
  const groups={products:groupFacts(facts,['productId','product','sku','company','marketplace','companyId']),marketplaces:groupFacts(facts,['marketplace']),companies:groupFacts(facts,['companyId','company']),agents:groupFacts(facts,['agentId','agent'])};
  const review=data.review.filter(r=>(!validDate(r.date)||(r.date>=filters.from&&r.date<=filters.to))&&(!filters.marketplace||r.marketplace===filters.marketplace));
  const insights=[];
  const ranked=(list,metric)=>list.filter(g=>g.totals[metric]!==null).sort((a,b)=>b.totals[metric]-a.totals[metric]);
  const topReturn=ranked(groups.products.filter(g=>g.totals.sold>0&&g.totals.customer>0),'returnRate')[0];
  if(topReturn)insights.push(`${topReturn.values[1]} has the highest customer return rate: ${metricText(topReturn.totals.returnRate,'returnRate')} (${topReturn.totals.customer}/${topReturn.totals.sold} units).`);
  const market=ranked(groups.marketplaces,'revenue')[0];if(market)insights.push(`${market.values[0]} leads net sales at ${metricText(market.totals.revenue,'revenue')}.`);
  const product=ranked(groups.products,'profit')[0];if(product)insights.push(`${product.values[1]} leads available estimated profit at ${metricText(product.totals.profit,'profit')}.`);
  if(comparable&&prior.extra>0)insights.push(`Confirmed return charges changed ${((totals.extra-prior.extra)/prior.extra*100).toFixed(2)}% versus ${priorRange.from} to ${priorRange.to}.`);
  const pending=agents.filter(a=>a.pending>0);if(pending.length&&!filters.marketplace&&!filters.productId)insights.push(`${pending.length} agent(s) have current all-time wallet obligations of ${metricText(pending.reduce((s,a)=>s+a.pending,0),'stock')}; independent of report dates.`);
  return {filters,facts,totals,prior,priorRange,comparable,financial,groups,agents,purchaseTotal,inventory:inventoryFor(state,filters),review,insights};
}
