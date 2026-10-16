import {aggregateFacts, groupFacts, METRICS} from './masterChartData.js';
export const PIVOT_ROWS={product:'Product',marketplace:'Marketplace',company:'Company',agent:'Agent',date:'Date'};
export const PIVOT_COLUMNS={marketplace:'Marketplace',company:'Company',product:'Product',month:'Month',agent:'Agent'};
export const PIVOT_VALUES=['revenue','orders','sold','net','refund','returnRate','extra','profit','stock'];
// Totals always aggregate supporting facts, never percentages or distinct-order subtotals.
export function buildMasterPivot(facts,{rows=['product'],column='marketplace',metric='revenue',search='',descending=true}={}){
  if(!rows.length||rows.some(r=>!PIVOT_ROWS[r])||!PIVOT_COLUMNS[column]||!PIVOT_VALUES.includes(metric))throw Error('Invalid analysis selection.');
  // Identical display names must not merge distinct product/company/agent IDs.
  const names=new Map();
  for(const dimension of ['product','company','agent'])for(const fact of facts){const key=dimension+':'+fact[dimension];if(!names.has(key))names.set(key,new Set());names.get(key).add(fact[dimension+'Id']||'unattributed');}
  const labelled=facts.map(f=>{const copy={...f};for(const d of ['product','company','agent'])if(names.get(d+':'+f[d])?.size>1)copy[d]=`${f[d]} · ${d==='product'&&f.sku?f.sku+' / ':''}${f[d+'Id']||'Unattributed'}`;return copy;});
  const filtered=labelled.filter(f=>!search||rows.map(r=>String(f[r]||'')).join(' ').toLowerCase().includes(search.toLowerCase()));
  const columns=[...new Set(filtered.map(f=>column==='month'?f.date.slice(0,7):f[column]))].sort();
  const cell=(records,c)=>aggregateFacts(records.filter(f=>(column==='month'?f.date.slice(0,7):f[column])===c))[metric];
  const groups=groupFacts(filtered,rows).map(g=>({...g,cells:columns.map(c=>cell(g.facts,c)),value:g.totals[metric]}))
    .sort((a,b)=>(descending?-1:1)*((a.value??-Infinity)-(b.value??-Infinity))||a.values.join(' / ').localeCompare(b.values.join(' / ')));
  const subtotals=groupFacts(filtered,[rows[0]]).map(g=>({...g,cells:columns.map(c=>cell(g.facts,c)),value:g.totals[metric]}));
  return {groups,subtotals,columns,grand:aggregateFacts(filtered)[metric],grandCells:columns.map(c=>cell(filtered,c)),metric,label:METRICS[metric].label,count:filtered.length};
}
