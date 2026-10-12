import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';

const today=()=>new Date().toISOString().slice(0,10);
const requestId=()=>crypto.randomUUID();
const blank=()=>({marketplace:'Amazon',date:today(),amount:'',reference:'',notes:''});
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2}).format(n/100);
export default function Banking({notify,Card,Stat,Mkt,DownloadButton}){
 const [filter,setFilter]=useState(()=>({mode:'all',date:today(),month:today().slice(0,7),from:today(),to:today(),marketplace:'',search:''}));
 const [report,setReport]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [draft,setDraft]=useState(blank),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[audit,setAudit]=useState(null);
 const pending=useRef(false),request=useRef(requestId()),deleteRequests=useRef(new Map());
 useEffect(()=>{let cancelled=false;setLoading(true);setReport(null);setError('');api.bankingReport(filter).then(data=>{if(!cancelled)setReport(data);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[filter,revision]);
 const change=(field,value)=>setFilter(f=>({...f,[field]:value}));
 const patch=(field,value)=>{request.current=requestId();setDraft(d=>({...d,[field]:value}));};
 const reset=()=>{setDraft(blank());setEditing(null);request.current=requestId();};
 const run=async action=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await action();}catch(e){setError(e.message);notify(e.message);if(e.status===409)setRevision(n=>n+1);}finally{pending.current=false;setBusy(false);}};
 const refresh=()=>{setAudit(null);setRevision(n=>n+1);};
 const save=e=>{e.preventDefault();void run(async()=>{
  if(!window.confirm(`${editing?'Correct':'Record'} ${draft.marketplace} bank receipt of ₹${draft.amount} on ${draft.date}? This affects Banking only.`))return;
  const payload={...draft,requestId:request.current,...(editing?{confirm:true,version:editing.version}:{})};
  const result=await api.saveBankSettlement(payload,editing?.id);reset();refresh();notify(result.replayed?'Settlement already recorded; no duplicate created.':'Bank settlement saved.');
 });};
 const remove=s=>void run(async()=>{if(!window.confirm(`Delete the incorrect ${s.marketplace} settlement of ${money(s.amountCents)} dated ${s.date}? Its details will remain in the audit trail.`))return;
  const key=s.id+':'+s.version;if(!deleteRequests.current.has(key))deleteRequests.current.set(key,requestId());
  await api.deleteBankSettlement(s.id,{requestId:deleteRequests.current.get(key),confirm:true,version:s.version});if(editing?.id===s.id)reset();refresh();notify('Incorrect settlement deleted; audit trail retained.');
 });
 const exportExcel=async()=>{const {blob,name}=await api.exportBanking(filter),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <>
 <Card className="flush"><div className="ph"><div><h3>Banking &amp; Marketplace Reconciliation</h3><p className="hint">Compare recorded sales with actual bank receipts. Banking entries are separate from sales and agent wallets.</p></div><DownloadButton label="Export Excel" action={exportExcel} disabled={!report||loading||busy}/></div>
 <div className="report-filters"><label>Period<select aria-label="Banking period" disabled={busy} value={filter.mode} onChange={e=>change('mode',e.target.value)}>{[['all','All Time'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['custom','Custom Date Range']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
 {['daily','weekly'].includes(filter.mode)&&<label>{filter.mode==='weekly'?'Date in week':'Date'}<input aria-label="Banking date" type="date" value={filter.date} onChange={e=>change('date',e.target.value)}/></label>}
 {filter.mode==='monthly'&&<label>Month / Year<input aria-label="Banking month" type="month" value={filter.month} onChange={e=>change('month',e.target.value)}/></label>}
 {filter.mode==='custom'&&<><label>From Date<input aria-label="Banking from date" type="date" value={filter.from} onChange={e=>change('from',e.target.value)}/></label><label>To Date<input aria-label="Banking to date" type="date" value={filter.to} onChange={e=>change('to',e.target.value)}/></label></>}
 <small>Inclusive UTC dates · Monday–Sunday weeks</small></div></Card>
 {error&&<p className="reason" role="alert">{error}</p>}{loading&&<p role="status">Loading banking report…</p>}
 {report&&<>
 <p className="note">{report.note}</p><p className="hint">{report.range.mode==='all'?'All Time':`${report.range.from} — ${report.range.to}`} · Sales use their sale date; receipts use Bank Received Date.</p>
 <div className="stats"><Stat label="Total Sales" value={money(report.totals.salesCents)} sub="Gross recorded sales for selected period"/><Stat label="Total Bank Received" value={money(report.totals.receivedCents)} sub="Receipts dated in selected period"/><Stat label="Reference Reconciliation Difference" value={money(report.totals.differenceCents)} sub="Sales − bank received; not profit or loss"/></div>
 <div className="stats banking-marketplaces">{report.marketplaces.map(m=><Card key={m.marketplace}><h3><Mkt name={m.marketplace}/></h3><p>Total Sales: <b>{money(m.salesCents)}</b></p><p>Total Bank Received: <b>{money(m.receivedCents)}</b></p><p>Reference Difference: <b>{money(m.differenceCents)}</b></p></Card>)}</div>
 <Card className="flush"><div className="ph"><h3>Marketplace Comparison</h3></div><div className="table-wrap"><table><thead><tr><th>Marketplace</th><th className="n">Total Sales</th><th className="n">Total Bank Received</th><th className="n">Reference Difference</th></tr></thead><tbody>{[...report.marketplaces,{marketplace:'Combined',...report.totals}].map(m=><tr key={m.marketplace}><td>{m.marketplace}</td><td className="n">{money(m.salesCents)}</td><td className="n">{money(m.receivedCents)}</td><td className="n">{money(m.differenceCents)}</td></tr>)}</tbody></table></div></Card>
 <Card><details><summary>Calculation and date rules</summary><p className="hint">{report.rules}</p>{report.undatedSales>0&&<p className="note">{report.undatedSales} undated historical sale(s) count in All Time only.</p>}</details></Card>
 </>}
 <form className="card" onSubmit={save}><h3>{editing?'Edit Bank Settlement':'Add Bank Settlement'}</h3><fieldset disabled={busy} className="purchase-fields"><div className="form-grid">
 <label>Marketplace<select value={draft.marketplace} onChange={e=>patch('marketplace',e.target.value)}>{['Amazon','Flipkart','Meesho'].map(m=><option key={m}>{m}</option>)}</select></label>
 <label>Bank Received Date<input required type="date" value={draft.date} onChange={e=>patch('date',e.target.value)}/></label>
 <label>Amount (₹)<input required type="number" min="0.01" max="9999999999.99" step="0.01" value={draft.amount} onChange={e=>patch('amount',e.target.value)}/></label>
 <label>Bank Reference / UTR (optional)<input maxLength={200} value={draft.reference} onChange={e=>patch('reference',e.target.value)}/></label>
 <label>Notes (optional)<textarea maxLength={2000} value={draft.notes} onChange={e=>patch('notes',e.target.value)}/></label></div>
 <div className="inline"><button type="submit">{busy?'Saving…':editing?'Confirm Correction':'Save Settlement'}</button>{editing&&<button type="button" className="ghost" onClick={reset}>Cancel Edit</button>}</div><p className="hint">Saving never changes sales, stock, purchases or wallet balances. Same marketplace/UTR and identical unreferenced receipts are rejected to prevent accidental duplicates.</p></fieldset></form>
 <Card className="flush"><div className="ph"><h3>Settlement History</h3><button className="ghost" disabled={busy} onClick={()=>void run(async()=>setAudit((await api.bankAudit()).entries))}>View Audit Trail</button></div>
 <div className="report-filters"><label>Search history<input aria-label="Search settlement history" maxLength={200} value={filter.search} onChange={e=>change('search',e.target.value)} placeholder="Reference, notes, amount or date"/></label><label>History marketplace<select aria-label="Settlement marketplace filter" value={filter.marketplace} onChange={e=>change('marketplace',e.target.value)}><option value="">All marketplaces</option>{['Amazon','Flipkart','Meesho'].map(m=><option key={m}>{m}</option>)}</select></label><small>The period filter above applies to history. Search and marketplace filters apply to history only; dashboard totals stay combined.</small></div>
 <div className="table-wrap"><table><thead><tr>{['Date','Marketplace','Amount Received','UTR / Reference','Notes','Created Date (UTC)','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report?.history.length?report.history.map(s=><tr key={s.id}><td>{s.date}</td><td><Mkt name={s.marketplace}/></td><td className="n">{money(s.amountCents)}</td><td className="code">{s.reference||'—'}</td><td className="wrap">{s.notes||'—'}</td><td>{s.createdAt.replace('T',' ').replace('Z',' UTC')}</td><td><div className="inline"><button className="ghost sm" disabled={busy} onClick={()=>{setEditing(s);setDraft({marketplace:s.marketplace,date:s.date,amount:(s.amountCents/100).toFixed(2),reference:s.reference,notes:s.notes});request.current=requestId();}}>Edit</button><button className="quiet sm" disabled={busy} onClick={()=>remove(s)}>Delete</button></div></td></tr>):<tr><td colSpan="7" className="empty">{loading?'Loading…':'No bank settlements in this view.'}</td></tr>}</tbody></table></div></Card>
 {audit&&<Card className="flush"><div className="ph"><h3>Settlement Audit Trail</h3><button className="ghost" onClick={()=>setAudit(null)}>Hide</button></div><p className="pb hint">Append-only correction history. Deleted settlements remain here and are excluded from receipt totals.</p><div className="table-wrap"><table><thead><tr><th>Recorded (UTC)</th><th>Action</th><th>Before</th><th>After</th><th>Settlement ID</th></tr></thead><tbody>{audit.length?audit.slice().reverse().map(a=><tr key={a.id}><td>{a.at}</td><td>{a.action}</td>{[a.before,a.after].map((s,i)=><td key={i} className="wrap">{s?<>{s.marketplace} · {s.date} · {money(s.amountCents)}<br/>Reference: {s.reference||'—'}<br/>Notes: {s.notes||'—'}{s.deletedAt&&<><br/>Deleted</>}</>:'—'}</td>)}<td className="code">{a.settlementId}</td></tr>):<tr><td colSpan="5" className="empty">No banking changes recorded.</td></tr>}</tbody></table></div></Card>}
 </>;
}
