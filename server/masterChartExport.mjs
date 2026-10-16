import XLSX from 'xlsx';
import {writeBrandedWorkbook} from './excelStyle.mjs';
import {buildMasterChart,METRICS} from '../client/src/masterChartData.js';
import {buildMasterPivot} from '../client/src/masterChartPivot.js';

const allowedFilters=['from','to','marketplace','companyId','agentId','productId'];
export function masterChartSelection(input={}){
  const filters=Object.fromEntries(allowedFilters.map(k=>[k,String(input.filters?.[k]||'')]));
  if(Object.values(filters).some(v=>v.length>200))throw Error('Invalid filter.');
  if(filters.marketplace&&!['Amazon','Flipkart','Meesho'].includes(filters.marketplace))throw Error('Invalid marketplace.');
  const raw=input.pivot||{};
  const rows=Array.isArray(raw.rows)?raw.rows:['product'];
  if(rows.length>2||new Set(rows).size!==rows.length)throw Error('Choose one or two distinct pivot row dimensions.');
  return {filters,pivot:{rows,column:raw.column||'marketplace',metric:raw.metric||'revenue',search:String(raw.search||'').slice(0,200),descending:raw.descending!==false}};
}
export function buildMasterChartWorkbook(state,input){
  const selection=masterChartSelection(input),r=buildMasterChart(state,selection.filters),p=buildMasterPivot(r.facts,selection.pivot);
  const wb=XLSX.utils.book_new();
  const money='"₹"#,##0.00;[Red]-"₹"#,##0.00';
  const metricValue=(v,m)=>v===null||v===undefined?'Not Available':METRICS[m]?.unit==='money'?v/100:METRICS[m]?.unit==='percent'?v/100:v;
  function sheet(name,headers,rows,kinds=[]){
    if(rows.length>250000)throw Error('Export is too large. Narrow the selected period.');
    const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
    ws['!cols']=headers.map((h,i)=>({wch:Math.min(65,Math.max(16,h.length+3,i===0?30:0))}));
    ws['!autofilter']={ref:XLSX.utils.encode_range({r:0,c:0},{r:rows.length,c:headers.length-1})};
    for(let row=1;row<=rows.length;row++)for(let col=0;col<headers.length;col++){
      const cell=ws[XLSX.utils.encode_cell({r:row,c:col})];
      if(cell?.t==='n'&&kinds[col])cell.z=kinds[col]==='money'?money:kinds[col]==='percent'?'0.00%':'#,##0.##';
    }
    ws['!rows']=[{hpt:28}];XLSX.utils.book_append_sheet(wb,ws,name);
  }
  const filterRows=Object.entries(selection.filters).map(([k,v])=>[k,v||'All']);
  sheet('Read Me',['SellQuanta Master Chart','Reporting definitions'],[
    ...filterRows,['Data','Read-only local business records; amounts in INR. No configuration or credentials exported.'],
    ['Pivot selection',JSON.stringify(selection.pivot)],
    ['Date basis','Sales: sale date; refunds: refund date; extra charges: saved expense date.'],
    ['Cumulative balances','Banking uses all dates for the selected marketplace. Wallets use the current whole-agent period since latest reset.'],
    ['Missing values','Not Available; no amounts, allocations or company stock ownership are guessed.'],
    ['Review scope','Unattributed review records retained for the selected marketplace/period, even under narrower dimension filters.'],
    ['Comparison',r.comparable?`${r.priorRange.from} to ${r.priorRange.to}`:'Insufficient data'],
    ['Estimate bridge','Waterfall bridge is a derived reconciliation to estimated profit, not itemized fees or tax.'],
    ...Object.entries(METRICS).map(([,m])=>[m.label,m.definition])]);
  sheet('Business Overview',['Metric','Value','Unit','Scope','Definition'],Object.entries(METRICS).map(([k,m])=>[m.label,metricValue(k==='due'?r.financial.due:r.totals[k],k),m.unit,k==='due'?'All-time Banking':'Selected period',m.definition]));
  const metrics=['gross','revenue','orders','sold','net','stock','profit','margin','customer','returnRate','rto','cancelled','unclassified','refund','extra','settlement'];
  function grouped(name,groups,labels,indexes){sheet(name,[...labels,...metrics.map(k=>METRICS[k].label)],groups.map(g=>[...indexes.map(i=>g.values[i]),...metrics.map(k=>metricValue(g.totals[k],k))]),[...labels.map(()=>null),...metrics.map(k=>METRICS[k].unit)]);}
  grouped('Products',r.groups.products,['Product','SKU','Company','Marketplace'],[1,2,3,4]);
  grouped('Marketplaces',r.groups.marketplaces,['Marketplace'],[0]);
  grouped('Companies',r.groups.companies,['Company'],[1]);
  grouped('Agent Performance',r.groups.agents,['Agent'],[1]);
  const factHeaders=['Date','Type','Reason','Order ID','Product','Warehouse SKU','Company','Marketplace','Agent','Sold units','Refund units','Gross sales','Refund amount','Stock cost','Estimated profit','Estimated settlement','Extra charges'];
  const factKinds=[null,null,null,null,null,null,null,null,null,'count','count','money','money','money','money','money','money'];
  const factRow=f=>[f.date,f.kind,f.reason||'',f.orderId,f.product,f.sku,f.company,f.marketplace,f.agent,f.sold,f.refunded,...['gross','refund','stock','profit','settlement','extra'].map(k=>metricValue(f[k],k))];
  sheet('Filtered Transactions',factHeaders,r.facts.map(factRow),factKinds);
  sheet('Return Analysis',factHeaders,r.facts.filter(f=>f.kind!=='Sale').map(factRow),factKinds);
  const walletUnavailable=!!(r.filters.marketplace||r.filters.productId);
  sheet('Agent Wallets',['Agent','Company','Net stock cost due','Wallet credits','Outstanding balance','Scope'],r.agents.map(a=>[a.name,a.company,...['due','paid','pending'].map(k=>walletUnavailable?'Not Available':a[k]/100),walletUnavailable?'Whole-agent balance cannot be split by product/marketplace':a.scope]),[null,null,'money','money','money']);
  sheet('Financial Position',['Metric','Amount INR','Scope'],[
    ['Gross recorded sales',metricValue(r.financial.estimated,'settlement'),'All-time · '+r.financial.note],['Bank received',metricValue(r.financial.received,'received'),'All-time'],
    ['Confirmed extra charges',metricValue(r.financial.extra,'extra'),'All-time'],['Reference difference',metricValue(r.financial.due,'due'),'All-time = gross recorded sales minus active receipts; charges are separate'],
    ['Purchase ledger',metricValue(r.purchaseTotal,'stock'),'Selected period; unavailable when dimension attribution unsupported']],[null,'money']);
  sheet('Pivot Analysis',[selection.pivot.rows.join(' / '),...p.columns,'Subtotal'],[
    ...p.groups.map(g=>[g.values.join(' / '),...g.cells.map(v=>metricValue(v,p.metric)),metricValue(g.value,p.metric)]),
    ...p.subtotals.map(g=>['SUBTOTAL '+g.values[0],...g.cells.map(v=>metricValue(v,p.metric)),metricValue(g.value,p.metric)]),
    ['GRAND TOTAL',...p.grandCells.map(v=>metricValue(v,p.metric)),metricValue(p.grand,p.metric)]],[null,...p.columns.map(()=>METRICS[p.metric].unit),METRICS[p.metric].unit]);
  sheet('Needs Review',['Date','Marketplace','Order ID','Reason','Saved extra charge'],r.review.map(f=>[f.date,f.marketplace,f.orderId,f.reviewReason,metricValue(f.extra,'extra')]),[null,null,null,null,'money']);
  sheet('Business Insights',['Period','Evidence-supported insight'],r.insights.length?r.insights.map(text=>[`${r.filters.from} to ${r.filters.to}`,text]):[[`${r.filters.from} to ${r.filters.to}`,'Insufficient data']]);
  return wb;
}
export function registerMasterChartRoutes(app,{readDb}){
  // POST carries export selections only. This handler has no mutation or file writer.
  app.post('/api/master-chart/export',async(req,res)=>{
    try{const workbook=buildMasterChartWorkbook(readDb(),req.body);const bytes=await writeBrandedWorkbook(workbook,{reportName:'Master Chart'});res.set('Cache-Control','no-store');res.set('Content-Disposition','attachment; filename="SellQuanta-Master-Chart.xlsx"');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.send(bytes);}
    catch(error){res.status(400).json({error:error.message});}
  });
}
