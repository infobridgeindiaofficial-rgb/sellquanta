// Presentation adapters only. All amounts remain integer cents and all aggregates
// come from the existing, verified Master Chart selectors.
import {aggregateFacts,groupFacts,metricText} from './masterChartData.js';
export {MARKETS as markets} from './masterChartData.js';
export const currency=(cents,compact=false)=>cents==null||!Number.isFinite(cents)?'Not Available':compact&&Math.abs(cents)>=10000000?'₹'+(cents/10000000).toFixed(2)+'L':metricText(cents,'revenue');
export const number=value=>value==null||!Number.isFinite(value)?'Not Available':new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(value);
export const percent=value=>value==null||!Number.isFinite(value)?'Not Available':value.toFixed(2)+'%';
export const monthLabel=value=>/^\d{4}-\d{2}$/.test(value)?new Date(value+'-02T12:00:00').toLocaleDateString('en-IN',{month:'short',year:'2-digit'}):value;
export const totals=rows=>{const t=aggregateFacts(rows);return {...t,qty:t.sold,rate:t.returnRate};};
export function groups(rows,key){
  const dimensions={name:['productId','product','sku'],company:['companyId','company'],agent:['agentId','agent'],productId:['productId','product','sku'],marketplace:['marketplace'],month:['month'],date:['date']}[key]||[key];
  const labelIndex=['name','company','agent','productId'].includes(key)?1:0;
  return groupFacts(rows,dimensions).map(g=>({...g.totals,qty:g.totals.sold,rate:g.totals.returnRate,key:g.key,values:g.values,name:g.values[labelIndex]||'Unattributed',records:g.facts}));
}
export function matrixGroups(report,search=''){
  return report.groups.products.map(g=>({...g.totals,qty:g.totals.sold,rate:g.totals.returnRate,key:g.key,name:g.values[1],sku:g.values[2],company:g.values[3],marketplace:g.values[4],productId:g.values[0],companyId:g.values[5],records:g.facts,
    currentStock:report.inventory?.find(p=>p.id===g.values[0])?.stock??null}))
    .filter(g=>(g.name+' '+g.sku+' '+g.company+' '+g.marketplace).toLowerCase().includes(search.toLowerCase()));
}
export function waterfallSteps(rows){
  const t=totals(rows);
  if([t.gross,t.refund,t.stock,t.profit,t.extra].some(v=>v===null))return null;
  const bridge=t.profit-(t.gross-t.refund-t.stock-t.extra);
  let running=0;
  const points=[['Gross',t.gross],['Refunds',-t.refund],['Stock cost',-t.stock],['Estimate bridge',bridge],['Extra',-t.extra]].map(([name,value])=>{const start=running;running+=value;return {name,value,start,end:running};});
  return [...points,{name:'Profit',value:t.profit,start:0,end:t.profit}];
}
