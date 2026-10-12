// Read-only reporting shared by the UI and Excel export. No store or filesystem imports.
export const REPORT_MARKETPLACES=['Amazon','Flipkart','Meesho'];
const money=n=>Math.round(Number(n||0)*100);
const day=(date,at)=>/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))?date:Number.isFinite(Date.parse(at||''))?new Date(at).toISOString().slice(0,10):'';
const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const shifted=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
export function reportRange(filter={},now=new Date()){
 const mode=filter.mode||'daily';const anchor=filter.date||now.toISOString().slice(0,10);
 let from,to;
 if(mode==='custom'){from=filter.from;to=filter.to;}
 else if(mode==='monthly'){if(!/^\d{4}-\d{2}$/.test(filter.month||''))throw Error('Select a month and year.');from=filter.month+'-01';const [y,m]=filter.month.split('-').map(Number);if(y<1900||y>9999||m<1||m>12)throw Error('Select a valid month and year.');to=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);}
 else if(mode==='yearly'){const y=Number(filter.year);if(!Number.isInteger(y)||y<1900||y>9999)throw Error('Select a valid year.');from=y+'-01-01';to=y+'-12-31';}
 else if(mode==='daily'||mode==='weekly'){if(!valid(anchor))throw Error('Select a valid date.');from=anchor;to=anchor;if(mode==='weekly'){const weekDay=new Date(anchor+'T00:00:00Z').getUTCDay();from=shifted(anchor,-((weekDay+6)%7));to=shifted(from,6);}}
 else throw Error('Unknown report period.');
 if(!valid(from)||!valid(to)||from>to)throw Error('Choose valid dates with From Date on or before To Date.');
 return {from,to,mode};
}
const unique=collections=>{const result=new Map();let unkeyed=0;for(const list of collections)for(const row of list||[])result.set(row.id||'unkeyed:'+unkeyed++,row);return [...result.values()];};
export function reportRecords(state){return {sales:unique([...(state.monthCloseArchive||[]).map(a=>a.sales),state.salesHistory,state.todaySales]),returns:unique([...(state.monthCloseArchive||[]).map(a=>a.refunds),state.refunds])};}
const marketplace=value=>REPORT_MARKETPLACES.find(m=>m.toLowerCase()===String(value||'').trim().toLowerCase())||String(value||'').trim()||'Unspecified';
export function salesReturnsReport(state,filter,now=new Date()){
 const range=reportRange(filter,now),records=reportRecords(state);const included=d=>d>=range.from&&d<=range.to;
 const agents=new Map((state.agents||[]).map(a=>[a.id,a.name]));const products=new Map((state.products||[]).map(p=>[p.id,p]));
 const saleById=new Map(records.sales.map(s=>[s.id,s]));
 const sales=records.sales.map(s=>({...s,reportDate:day(s.date,s.createdAt),marketplace:marketplace(s.marketplace),agentName:s.agentName||agents.get(s.agentId)||'Unassigned',productName:s.productName||products.get(s.productId)?.name||'Unknown product'})).filter(s=>included(s.reportDate));
 const returns=records.returns.map(r=>{const original=saleById.get(r.saleId)||{};return {...r,reportDate:day(r.refundDate,r.refundedAt),agentId:r.agentId||original.agentId,productId:r.productId||original.productId,marketplace:marketplace(r.marketplace||original.marketplace),agentName:r.agentName||original.agentName||agents.get(r.agentId||original.agentId)||'Unassigned',productName:r.productName||original.productName||products.get(r.productId||original.productId)?.name||'Unknown product',orderId:r.orderId||original.orderId||''};}).filter(r=>included(r.reportDate));
 const tally=(ss,rr)=>{const orders=new Set(ss.map(s=>JSON.stringify([s.accountId||s.agentId,s.marketplace,s.reportDate,String(s.orderId||s.id||'').trim().toLowerCase()])));const totalSalesCents=ss.reduce((n,s)=>n+money(s.saleAmount),0),returnAmountCents=rr.reduce((n,r)=>n+money(r.refundAmount),0);return {totalSalesCents,orders:orders.size,unitsSold:ss.reduce((n,s)=>n+Number(s.qty||0),0),returnsCount:rr.length,returnedUnits:rr.reduce((n,r)=>n+Number(r.qty||0),0),returnAmountCents,netSalesCents:totalSalesCents-returnAmountCents};};
 const group=(key,label)=>{const groups=new Map();for(const row of [...sales,...returns]){const id=key(row);if(!groups.has(id))groups.set(id,{id,name:label(row)});}return [...groups.values()].map(g=>({...g,...tally(sales.filter(s=>key(s)===g.id),returns.filter(r=>key(r)===g.id))})).sort((a,b)=>a.name.localeCompare(b.name));};
 const marketplaces=REPORT_MARKETPLACES.map(name=>({id:name,name,...tally(sales.filter(s=>s.marketplace===name),returns.filter(r=>r.marketplace===name))}));
 for(const g of group(r=>r.marketplace,r=>r.marketplace))if(!REPORT_MARKETPLACES.includes(g.id))marketplaces.push(g);
 const large=(Date.parse(range.to)-Date.parse(range.from))/86400000>62;const key=r=>large?r.reportDate.slice(0,7):r.reportDate;
 const trends=[];for(let d=range.from;d<=range.to;){const bucket=large?d.slice(0,7):d;trends.push({date:bucket,...tally(sales.filter(s=>key(s)===bucket),returns.filter(r=>key(r)===bucket))});if(large){const next=new Date(d+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1,1);if(next.getUTCFullYear()>9999)break;d=next.toISOString().slice(0,10);}else{if(d==='9999-12-31')break;d=shifted(d,1);}}
 const missingDates=records.sales.filter(s=>!day(s.date,s.createdAt)).length+records.returns.filter(r=>!day(r.refundDate,r.refundedAt)).length;
 const descending=(a,b)=>b.reportDate.localeCompare(a.reportDate)||String(b.createdAt||b.refundedAt||'').localeCompare(String(a.createdAt||a.refundedAt||''));
 return {range,totals:tally(sales,returns),sales:sales.sort(descending),returns:returns.sort(descending),marketplaces,agents:group(r=>r.agentId||'unassigned',r=>r.agentName),products:group(r=>r.productId||r.warehouseProductCode||r.sku||r.productName,r=>r.productName),trends,missingDates};
}
