import React, {useState,useEffect,useRef} from 'react';
import {METRICS,metricText,groupFacts,aggregateFacts,bucketDate} from './masterChartData.js';
import {buildMasterPivot,PIVOT_ROWS,PIVOT_COLUMNS,PIVOT_VALUES} from './masterChartPivot.js';
import MasterVisual from './masterChartCharts.jsx';

export function MasterKPIs({report}){
  const keys=['gross','revenue','orders','sold','net','profit','margin','returnRate','rto','cancelled','extra','settlement','received','due'];
  return <div className="mc-kpis">{keys.map(key=>{const v=key==='due'?report.financial.due:report.totals[key],previous=report.prior[key];const comparison=key!=='due'&&key!=='received'&&report.comparable&&previous>0&&v!==null?(v-previous)/previous*100:null;return <article key={key} title={METRICS[key].definition}>
    <span>{METRICS[key].label} <abbr title={METRICS[key].definition}>ⓘ</abbr></span><strong className={v!==null&&v<0?'mc-negative':''}>{metricText(v,key)}</strong>
    <small>{key==='due'?'All-time · Banking reconciliation':key==='received'?'Selected period · receipt dates':comparison!==null?`${comparison>=0?'+':''}${comparison.toFixed(2)}% vs equal-length prior period`:'Selected transaction period'}</small>
  </article>;})}</div>;
}

export function MasterTable({title,groups,dimensions,metrics,onGroup,metricSort='revenue'}){
  const [search,setSearch]=useState(''),[sort,setSort]=useState(metricSort),[desc,setDesc]=useState(true);
  const rows=groups.filter(g=>g.values.join(' ').toLowerCase().includes(search.toLowerCase())).slice().sort((a,b)=>
    (desc?-1:1)*((a.totals[sort]??-Infinity)-(b.totals[sort]??-Infinity))||a.values.join(' ').localeCompare(b.values.join(' ')));
  return <article className="mc-panel"><div className="mc-panel-title"><h3>{title}</h3><label>Search<input aria-label={`Search ${title}`} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a record…"/></label></div>
    <div className="table-wrap"><table><thead><tr>{dimensions.map(d=><th key={d.label}>{d.label}</th>)}{metrics.map(m=><th className="n" key={m}><button type="button" title={METRICS[m].definition} onClick={()=>{setSort(m);setDesc(sort===m?!desc:true);}}>{METRICS[m].label}{sort===m?(desc?' ↓':' ↑'):''}</button></th>)}</tr></thead>
      <tbody>{rows.length?rows.map(g=><tr key={g.key}>{dimensions.map((d,i)=><td key={d.label} className={i===0?'mc-name':''}>{i===0&&onGroup?<button type="button" className="mc-text-button" onClick={()=>onGroup(g)}>{g.values[d.index]||'Unattributed'}</button>:g.values[d.index]||'—'}</td>)}{metrics.map(m=><td key={m} className={`n ${m==='returnRate'&&g.totals[m]>=20?'mc-rate-high':''}`}>{metricText(g.totals[m],m)}</td>)}</tr>):<tr><td colSpan={dimensions.length+metrics.length} className="empty-cell">No matching records in this period.</td></tr>}</tbody>
    </table></div><p className="mc-caption">{rows.length} groups · Click a name to cross-filter. Click a metric heading to sort. Missing values remain unavailable.</p>
  </article>;
}

export function MasterSales({report,drill}){
  const [grain,setGrain]=useState('daily'),[metric,setMetric]=useState('revenue'),[chart,setChart]=useState('line');
  const groups=groupFacts(report.facts.map(f=>({...f,bucket:bucketDate(f.date,grain)})),['bucket']).sort((a,b)=>a.values[0].localeCompare(b.values[0]));
  const data=groups.map(g=>({key:g.key,label:g.values[0],value:g.totals[metric],second:metric==='revenue'?g.totals.gross:undefined,facts:g.facts}));
  const ranked=groups.filter(g=>g.totals.revenue!==null).slice().sort((a,b)=>b.totals.revenue-a.totals.revenue);
  return <><div className="mc-local-controls"><label>Time grain<select value={grain} onChange={e=>setGrain(e.target.value)}>{['daily','weekly','monthly','yearly'].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Measure<select value={metric} onChange={e=>setMetric(e.target.value)}>{['revenue','orders','sold'].map(m=><option value={m} key={m}>{METRICS[m].label}</option>)}</select></label>
    <label>Chart<select value={chart} onChange={e=>setChart(e.target.value)}>{['line','area','bar','comparison'].map(v=><option key={v}>{v}</option>)}</select></label>
    <span>Average order value <b>{metricText(report.totals.aov,'aov')}</b></span></div>
    <MasterVisual title={`${grain[0].toUpperCase()+grain.slice(1)} sales performance`} type={chart} data={data} metric={metric} secondaryLabel="Gross sales" onSelect={d=>drill(d.label,d.facts)}/>
    <div className="mc-grid"><MasterVisual title="Gross vs net sales" type="comparison" metric="revenue" data={groups.map(g=>({label:g.values[0],value:g.totals.gross,second:g.totals.revenue,facts:g.facts}))} secondaryLabel="Net sales" onSelect={d=>drill(d.label,d.facts)}/>
    <MasterVisual title="Net sales vs estimated profit" type="comparison" data={groups.map(g=>({label:g.values[0],value:g.totals.revenue,second:g.totals.profit,facts:g.facts}))} secondaryLabel="Estimated profit" onSelect={d=>drill(d.label,d.facts)}/></div>
    <p className="mc-callout">Observed active periods only · Best: {ranked[0]?.values[0]||'Insufficient data'} · Weakest: {ranked.at(-1)?.values[0]||'Insufficient data'}. Growth is shown only when current and previous periods both contain sales.</p>
    <MasterVisual title="Daily net revenue heatmap" type="heatmap" data={groupFacts(report.facts,['date']).sort((a,b)=>a.values[0].localeCompare(b.values[0])).map(g=>({label:g.values[0],value:g.totals.revenue,facts:g.facts}))} onSelect={d=>drill(d.label,d.facts)}/>
  </>;
}

export function MasterProducts({report,select,drill}){
  const [rank,setRank]=useState('sold'),[direction,setDirection]=useState('highest'),[left,setLeft]=useState(''),[right,setRight]=useState('');
  const products=groupFacts(report.facts,['productId','product']);
  const ranks=report.groups.products.filter(g=>g.totals[rank]!==null).slice().sort((a,b)=>(direction==='highest'?-1:1)*(a.totals[rank]-b.totals[rank]));
  const chosen=products.filter(g=>g.values[0]===left||g.values[0]===right);
  return <><div className="mc-local-controls"><label>Rank by<select value={rank} onChange={e=>setRank(e.target.value)}>{['sold','profit','returnRate','revenue'].map(m=><option value={m} key={m}>{METRICS[m].label}</option>)}</select></label><label>Order<select value={direction} onChange={e=>setDirection(e.target.value)}><option value="highest">Highest first</option><option value="lowest">Lowest first</option></select></label></div>
    <MasterVisual title="Product performance ranking · top 10" data={ranks.slice(0,10).map(g=>({label:g.values[1],value:g.totals[rank],group:g}))} metric={rank} onSelect={d=>d.group.values[0]?select({productId:d.group.values[0]},d.label):drill(d.label,d.group.facts)}/>
    <div className="mc-grid"><MasterVisual title="Product revenue footprint" type="treemap" data={products.map(g=>({label:g.values[1],value:g.totals.gross,group:g}))} metric="gross" onSelect={d=>select({productId:d.group.values[0]},d.label)}/>
      <MasterVisual title="Sales volume vs customer returns" type="scatter" data={products.map(g=>({label:g.values[1],value:g.totals.sold,y:g.totals.returnRate,group:g}))} metric="sold" onSelect={d=>drill(d.label,d.group.facts)}/></div>
    <MasterTable title="Product performance" groups={report.groups.products} dimensions={[{label:'Product',index:1},{label:'Warehouse SKU',index:2},{label:'Company',index:3},{label:'Marketplace',index:4}]} metrics={['sold','net','gross','revenue','stock','profit','margin','returnRate','rto','cancelled','extra']} onGroup={g=>g.values[0]?select({productId:g.values[0],marketplace:g.values[4]},g.values[1]):drill(g.values[1],g.facts)}/>
    <article className="mc-panel"><div className="mc-panel-title"><h3>Product vs Product</h3></div><div className="mc-local-controls">{[['Product A',left,setLeft],['Product B',right,setRight]].map(([label,value,set])=><label key={label}>{label}<select value={value} onChange={e=>set(e.target.value)}><option value="">Choose product</option>{products.filter(g=>g.values[0]).map(g=><option key={g.key} value={g.values[0]}>{g.values[1]}</option>)}</select></label>)}</div>
      {chosen.length===2?<MasterVisual title="Selected product net sales / estimated profit" type="comparison" data={chosen.map(g=>({label:g.values[1],value:g.totals.revenue,second:g.totals.profit,facts:g.facts}))} secondaryLabel="Estimated profit" onSelect={d=>drill(d.label,d.facts)}/>:<p className="mc-caption">Choose two distinct products for the current filtered period.</p>}</article>
    <article className="mc-panel"><div className="mc-panel-title"><h3>Warehouse availability & movement</h3><span>Current stock · sales from selected period</span></div>
      {report.inventory===null?<p className="mc-caption">Not Available: shared warehouse stock cannot be attributed to company, marketplace or agent without saved ownership.</p>:<div className="table-wrap"><table><thead><tr><th>Product / SKU</th><th className="n">Current stock</th><th className="n">Current stock value</th><th>Period movement</th></tr></thead><tbody>{report.inventory.map(p=>{const quantity=aggregateFacts(report.facts.filter(f=>f.productId===p.id)).sold;return <tr key={p.id}><td><button className="mc-text-button" onClick={()=>select({productId:p.id},p.product)}>{p.product} · {p.sku}</button></td><td className="n">{p.stock??'Not Available'}</td><td className="n">{metricText(p.value,'stock')}</td><td>{quantity===0&&p.stock>0?`No recorded sales from ${report.filters.from} to ${report.filters.to}; current stock ${p.stock}. Review movement; stock history unavailable.`:`${quantity} units sold in selected period`}</td></tr>;})}</tbody></table></div>}
    </article>
  </>;
}

export function MasterSegments({report,type,select,drill}){
  const isMarket=type==='marketplaces',isCompany=type==='companies';
  const groups=report.groups[type],nameIndex=isMarket?0:1;
  const filterKey=isMarket?'marketplace':isCompany?'companyId':'agentId';
  const label=isMarket?'Marketplace':isCompany?'Company':'Agent';
  return <><div className="mc-grid"><MasterVisual title={`${label} net sales comparison`} type="comparison" data={groups.map(g=>({label:g.values[nameIndex],value:g.totals.revenue,second:g.totals.profit,group:g}))} secondaryLabel="Estimated profit" onSelect={d=>select({[filterKey]:d.group.values[0]},d.label)}/>
    <MasterVisual title={`${label} gross revenue contribution`} type="donut" data={groups.map(g=>({label:g.values[nameIndex],value:g.totals.gross,group:g}))} metric="gross" onSelect={d=>select({[filterKey]:d.group.values[0]},d.label)}/></div>
    {isMarket&&<MasterVisual title="Marketplace units · net units + refunded units = gross sold" type="stacked" metric="sold" secondaryLabel="All refunded units" data={groups.map(g=>({label:g.values[0],value:g.totals.net,second:g.totals.refunded,group:g}))} onSelect={d=>select({marketplace:d.group.values[0]},d.label)}/>}
    <MasterTable title={`${label} performance`} groups={groups} dimensions={[{label,index:nameIndex}]} metrics={['gross','revenue','orders','sold','net','customer','returnRate','rto','cancelled','refund','extra','stock','profit','margin','settlement']} onGroup={g=>g.values[0]?select({[filterKey]:g.values[0]},g.values[nameIndex]):drill(g.values[nameIndex],g.facts)}/>
    {isCompany&&<p className="mc-callout">Company stock value: Not Available. Current warehouse records do not establish company ownership; shared stock is not allocated by sales proportions.</p>}
    {isCompany&&<MasterTable title="Company → marketplace → product" groups={groupFacts(report.facts,['companyId','company','marketplace','productId','product'])} dimensions={[{label:'Company',index:1},{label:'Marketplace',index:2},{label:'Product',index:4}]} metrics={['revenue','net','profit','returnRate']} onGroup={g=>select({companyId:g.values[0],marketplace:g.values[2],productId:g.values[3]},g.values[4])}/>}
    {!isCompany&&<MasterTable title={`${label} → product → orders`} groups={groupFacts(report.facts,[isMarket?'marketplace':'agentId','productId','product','orderId'])} dimensions={[{label,index:0},{label:'Product',index:2},{label:'Order ID',index:3}]} metrics={['sold','net','revenue','stock','profit']} onGroup={g=>drill(g.values.join(' / '),g.facts)}/>}
    {type==='agents'&&<article className="mc-panel"><div className="mc-panel-title"><h3>Current agent wallet obligations</h3><span>All-time since last wallet reset · independent of transaction filters</span></div>
      {report.filters.marketplace||report.filters.productId?<p className="mc-caption">Wallet allocation by marketplace or product is Not Available. Clear those filters to see whole-agent balances.</p>:<div className="table-wrap"><table><thead><tr><th>Agent</th><th>Company</th><th className="n">Net stock cost due</th><th className="n">Wallet credits</th><th className="n">Outstanding balance</th></tr></thead><tbody>{report.agents.map(a=><tr key={a.id}><td><button className="mc-text-button" onClick={()=>select({agentId:a.id},a.name)}>{a.name}</button></td><td>{a.company}</td><td className="n">{metricText(a.due,'stock')}</td><td className="n">{metricText(a.paid,'stock')}</td><td className="n">{metricText(a.pending,'stock')}</td></tr>)}</tbody></table></div>}
    </article>}
  </>;
}

export function MasterReturns({report,drill}){
  const groups=report.groups.products;
  return <><p className="mc-callout">Customer Return % = customer returned units / gross sold units. RTO, Cancelled and unclassified quantities remain separate. Returned stock cost is not a proven permanent loss.</p>
    <div className="mc-grid"><MasterVisual title="Customer return rate by product" metric="returnRate" data={groups.filter(g=>g.totals.sold>0).map(g=>({label:g.values[1],value:g.totals.returnRate,facts:g.facts}))} onSelect={d=>drill(d.label,d.facts)}/>
      <MasterVisual title="Marketplace customer return rates" metric="returnRate" data={report.groups.marketplaces.map(g=>({label:g.values[0],value:g.totals.returnRate,facts:g.facts}))} onSelect={d=>drill(d.label,d.facts)}/></div>
    <MasterTable title="Return & charge analysis" groups={groups} dimensions={[{label:'Product',index:1},{label:'Company',index:3},{label:'Marketplace',index:4}]} metrics={['sold','customer','returnRate','rto','cancelled','unclassified','refund','extra']} onGroup={g=>drill(g.values[1],g.facts)}/>
    <MasterVisual title="Customer returned units over time" type="line" metric="customer" data={groupFacts(report.facts,['date']).sort((a,b)=>a.values[0].localeCompare(b.values[0])).map(g=>({label:g.values[0],value:g.totals.customer,facts:g.facts}))} onSelect={d=>drill(d.label,d.facts)}/>
    <MasterReview report={report}/>
  </>;
}
export function MasterReview({report}){return <article className="mc-panel"><div className="mc-panel-title"><h3>Unmatched / Unconfirmed / Needs Review</h3><span>{report.review.length} records · excludes invented allocations</span></div>
  <p className="mc-caption">This review list retains records for the selected marketplace and period, including missing-date records. Unattributed records remain visible even when narrower dimension filters are applied.</p>
  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Marketplace</th><th>Order ID</th><th>Reason / classification</th><th className="n">Saved charge</th></tr></thead><tbody>{report.review.length?report.review.map((r,i)=><tr key={r.id+':'+i}><td>{r.date||'Undated'}</td><td>{r.marketplace}</td><td>{r.orderId||'—'}</td><td className="mc-name">{r.reviewReason}</td><td className="n">{metricText(r.extra,'extra')}</td></tr>):<tr><td colSpan="5" className="empty-cell">No review records for this period.</td></tr>}</tbody></table></div></article>;}

export function MasterFinancial({report,drill}){
  const t=report.totals,available=[t.gross,t.refund,t.stock,t.profit,t.extra].every(v=>v!==null);
  const bridge=available?t.profit-(t.gross-t.refund-t.stock-t.extra):null;
  const steps=available?[['Gross sales',t.gross],['Refund amounts',-t.refund],['Net stock cost',-t.stock],['Unitemized estimate bridge',bridge],['Confirmed extra charges',-t.extra]]:[];
  let running=0;const waterfall=steps.map(([label,value])=>{const start=running;running+=value;return {label,value,start,end:running,facts:report.facts};});
  if(available)waterfall.push({label:'Estimated net profit',value:t.profit,start:0,end:t.profit,facts:report.facts});
  return <><p className="mc-callout">Revenue, estimated profit and bank cash are distinct. The unitemized estimate bridge is a derived reconciliation to saved estimates, not a claimed fee or tax breakdown.</p>
    <MasterVisual title="Financial waterfall · gross sales to estimated net profit" type="waterfall" data={waterfall} metric="profit" onSelect={d=>drill(d.label,d.facts)}/>
    <article className="mc-panel"><div className="mc-panel-title"><h3>Financial position</h3><span>{report.financial.scope}</span></div><div className="mc-kpis">
      {[[report.financial.estimated,'settlement','All-time estimated settlement'],[report.financial.received,'received','All-time bank received'],[report.financial.extra,'extra','All-time confirmed return charges'],[report.financial.due,'due','All-time final settlement due'],[report.purchaseTotal,'stock','Selected-period purchase ledger']].map(([value,key,label])=><article key={label} title={METRICS[key].definition}><span>{label}</span><strong>{metricText(value,key)}</strong></article>)}
    </div><p className="mc-caption">{report.financial.note} Final Settlement Due = Estimated Settlement − Bank Received − Return Extra Charges. Purchases have no reliable dimension links; scoped purchase totals are unavailable.</p></article>
    <MasterVisual title="Net revenue and estimated profit by month" type="comparison" data={groupFacts(report.facts,['month']).map(g=>({label:g.values[0],value:g.totals.revenue,second:g.totals.profit,facts:g.facts}))} secondaryLabel="Estimated profit" onSelect={d=>drill(d.label,d.facts)}/>
  </>;
}

export function MasterPivot({report,selection,setSelection,drill}){
  const pivot=buildMasterPivot(report.facts,selection);
  const change=(k,v)=>setSelection({...selection,[k]:v});
  return <><article className="mc-panel"><div className="mc-panel-title"><h3>Analysis Builder</h3><span>Distinct orders and weighted percentages</span></div><div className="mc-local-controls">
    <label>Rows<select aria-label="Pivot rows" value={selection.rows[0]} onChange={e=>change('rows',[e.target.value,...selection.rows.slice(1).filter(v=>v!==e.target.value)])}>{Object.entries(PIVOT_ROWS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>Second row level<select value={selection.rows[1]||''} onChange={e=>change('rows',[selection.rows[0],...(e.target.value?[e.target.value]:[])])}><option value="">None</option>{Object.entries(PIVOT_ROWS).filter(([v])=>v!==selection.rows[0]).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>Columns<select aria-label="Pivot columns" value={selection.column} onChange={e=>change('column',e.target.value)}>{Object.entries(PIVOT_COLUMNS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>Values<select aria-label="Pivot values" value={selection.metric} onChange={e=>change('metric',e.target.value)}>{PIVOT_VALUES.map(v=><option key={v} value={v}>{METRICS[v].label}</option>)}</select></label>
    <label>Search<input value={selection.search} onChange={e=>change('search',e.target.value)} placeholder="Search row labels"/></label>
    <button className="ghost" onClick={()=>change('descending',!selection.descending)}>{selection.descending?'Sort ascending':'Sort descending'}</button>
  </div></article>
  <article className="mc-panel"><div className="mc-panel-title"><h3>{pivot.label} by {selection.rows.map(r=>PIVOT_ROWS[r]).join(' → ')}</h3><span>{pivot.count} supporting transactions</span></div><div className="table-wrap"><table className="mc-pivot-table"><thead><tr><th>Row group</th>{pivot.columns.map(c=><th className="n" key={c}>{c||'Unattributed'}</th>)}<th className="n">Subtotal</th></tr></thead><tbody>
    {pivot.subtotals.map(s=><React.Fragment key={s.key}><tr className="mc-subtotal"><td>{s.values[0]||'Unattributed'}</td>{s.cells.map((v,i)=><td className="n" key={i}>{metricText(v,selection.metric)}</td>)}<td className="n">{metricText(s.value,selection.metric)}</td></tr>
      <tr><td colSpan={pivot.columns.length+2}><details open><summary>Expand / collapse {s.values[0]}</summary><table><tbody>{pivot.groups.filter(g=>g.values[0]===s.values[0]).map(g=><tr key={g.key}><td><button className="mc-text-button" onClick={()=>drill(g.values.join(' / '),g.facts)}>{g.values.join(' / ')}</button></td>{g.cells.map((v,i)=><td key={i} className={`n ${selection.metric==='returnRate'&&v>=20?'mc-rate-high':''}`}>{metricText(v,selection.metric)}</td>)}<td className="n">{metricText(g.value,selection.metric)}</td></tr>)}</tbody></table></details></td></tr>
    </React.Fragment>)}
    <tr className="mc-grand-total"><td>Grand Total</td>{pivot.grandCells.map((v,i)=><td className="n" key={i}>{metricText(v,selection.metric)}</td>)}<td className="n">{metricText(pivot.grand,selection.metric)}</td></tr>
  </tbody></table></div><p className="mc-caption">Subtotals and grand totals are recalculated from facts. Return % is never averaged; order counts may be smaller than summed rows when an order contains multiple products.</p></article></>;
}

export function MasterInsights({report}){return <article className="mc-panel mc-insights"><div className="mc-panel-title"><h3>Business Insights</h3><span>{report.filters.from} → {report.filters.to} · deterministic evidence</span></div>
  {report.insights.length?<ol>{report.insights.map((text,i)=><li key={i}>{text}</li>)}</ol>:<div className="mc-empty">Insufficient data</div>}
  <p className="mc-caption">No predictions. Estimates use captured values where available; legacy figures may use current unique Product Master mappings. Missing values are not zero.</p></article>;}

// Presentation reuses the report model, with shorter views rather than interactive work tables.
export function MasterPresentation({report,section,drill}){
  const chart=(title,groups,nameIndex,metric='revenue',type='bar')=><MasterVisual title={title} type={type} metric={metric} data={groups.map(g=>({label:g.values[nameIndex],value:g.totals[metric],facts:g.facts}))} onSelect={d=>drill(d.label,d.facts)}/>;
  const top=(groups,metric)=>groups.filter(g=>g.totals[metric]!==null).slice().sort((a,b)=>b.totals[metric]-a.totals[metric]).slice(0,6);
  if(section==='overview')return <><div className="mc-kpis">{['gross','revenue','profit','margin','returnRate','extra'].map(key=><article key={key} title={METRICS[key].definition}><span>{METRICS[key].label}</span><strong>{metricText(report.totals[key],key)}</strong></article>)}</div><MasterInsights report={{...report,insights:report.insights.slice(0,3)}}/></>;
  if(section==='sales')return <>{chart('Net sales over time',groupFacts(report.facts,['date']).sort((a,b)=>a.values[0].localeCompare(b.values[0])),0,'revenue','area')}<p className="mc-callout">{report.totals.orders} orders · {report.totals.sold} gross units · {report.totals.net} net units · Average order value {metricText(report.totals.aov,'aov')}. {report.comparable&&report.prior.revenue>0&&report.totals.revenue!==null?`Net revenue changed ${((report.totals.revenue-report.prior.revenue)/report.prior.revenue*100).toFixed(2)}% against the equal-length prior period.`:'Prior-period growth: Insufficient data.'}</p></>;
  if(section==='products')return <div className="mc-grid">{chart('Leading products · net revenue',top(report.groups.products,'revenue'),1)}{chart('Leading products · estimated profit',top(report.groups.products,'profit'),1,'profit')}</div>;
  if(section==='marketplaces')return <div className="mc-grid">{chart('Marketplace gross revenue contribution',report.groups.marketplaces,0,'gross','donut')}{chart('Marketplace estimated profit',report.groups.marketplaces,0,'profit')}</div>;
  if(section==='companies')return <div className="mc-grid">{chart('Company net sales',report.groups.companies,1)}{chart('Company estimated profit',report.groups.companies,1,'profit')}</div>;
  if(section==='agents')return <>{chart('Agent period net revenue',report.groups.agents,1)}<p className="mc-callout">{report.filters.marketplace||report.filters.productId?'Whole-agent outstanding balance: Not Available for marketplace/product slices.':`Current whole-agent outstanding balance: ${metricText(report.agents.reduce((s,a)=>s+a.pending,0),'stock')}. All-time since latest wallet reset; independent of selected transaction dates.`}</p></>;
  if(section==='returns')return <>{chart('Products with highest customer return rate',top(report.groups.products.filter(g=>g.totals.sold>0),'returnRate'),1,'returnRate')}<p className="mc-callout">Customer returns: {report.totals.customer} · RTO: {report.totals.rto} · Cancelled: {report.totals.cancelled} · Unclassified: {report.totals.unclassified}. Confirmed extra charges: {metricText(report.totals.extra,'extra')}. Unmatched / review records: {report.review.length}. Returned stock cost is not a permanent loss.</p></>;
  if(section==='financial')return <MasterFinancial report={report} drill={drill}/>;
  return <MasterInsights report={report}/>;
}

export function MasterRecords({title,facts,close}){
  const dialog=useRef(null);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector('button')?.focus();return()=>previous?.focus?.();},[]);
  const trap=e=>{if(e.key!=='Tab')return;const items=dialog.current.querySelectorAll('button,a,input,select,[tabindex="0"]');if(!items.length)return;const first=items[0],last=items[items.length-1];if((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last)){e.preventDefault();(e.shiftKey?last:first).focus();}};
  return <section ref={dialog} onKeyDown={trap} className="mc-drill" role="dialog" aria-modal="true" aria-label="Supporting transactions">
    <div className="mc-panel-title"><div><small>MASTER CHART / SUPPORTING RECORDS</small><h2>{title}</h2></div><button className="ghost" onClick={close}>Back to analysis</button></div>
    <p>{facts.length} supporting records · read-only</p>
    <div className="table-wrap"><table><thead><tr>{['Date','Type / reason','Order ID','Product / SKU','Company','Marketplace','Agent','Gross qty','Refund qty','Net invoice','Stock cost','Est. profit','Extra charges'].map(h=><th key={h}>{h}</th>)}</tr></thead>
      <tbody>{facts.map(f=><tr key={f.id}>
        <td>{f.date}</td><td>{f.kind}{f.reason?' / '+f.reason:''}<small className="return-product-code">{f.provenance||''}</small></td><td>{f.orderId||'—'}</td><td className="mc-name">{f.product} / {f.sku||'—'}</td>
        <td>{f.company}</td><td>{f.marketplace}</td><td>{f.agent}</td><td className="n">{f.sold}</td><td className="n">{f.refunded}</td>
        <td className="n">{metricText(f.gross===null||f.refund===null?null:f.gross-f.refund,'revenue')}</td><td className="n">{metricText(f.stock,'stock')}</td><td className="n">{metricText(f.profit,'profit')}</td><td className="n">{metricText(f.extra,'extra')}</td>
      </tr>)}</tbody></table></div>
  </section>;
}

