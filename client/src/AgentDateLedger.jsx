import React,{useState} from 'react';
import {localToday} from './dashboardStats';
import {agentDateLedger} from './agentDateLedgerData.js';
const money=value=>value===null?'Not available':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value);
export default function AgentDateLedger({state,agentId}){
 const today=localToday(),[from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today);const d=agentDateLedger(state,agentId,from,to);
 return <div className="detail-sec agent-date-ledger" aria-label="Agent date-wise ledger"><div className="section-head"><h3>Date-wise Ledger</h3><div className="agent-ledger-filters"><label>From Date<input aria-label="Agent ledger From Date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To Date<input aria-label="Agent ledger To Date" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="ghost" onClick={()=>{setFrom(today);setTo(today);}}>Today</button></div></div>
 {!from||!to||from>to?<p className="form-error">Select a valid date range.</p>:null}
 <div className="summary-strip">{[['Total quantity sold',d.sold],['Total quantity refunded',d.refunded],['Net quantity',d.net],['Net stock cost due',money(d.cost)],['Wallet credits',money(d.credits)],['Balance',money(d.balance)]].map(([label,value])=><div className="ss" key={label}><span className="sl">{label}</span><b className="sv">{value}</b></div>)}</div>
 <div className="table-wrap scroll"><table aria-label="Agent dated transactions"><thead><tr>{['Date','Marketplace','Order ID','Product','Quantity','Unit Cost','Total Stock Cost','Transaction Type','Amount'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{d.rows.length?d.rows.map(r=><tr key={r.id} className={r.type === 'Sale' ? 'agent-ledger-sale' : r.type === 'Refund' ? 'agent-ledger-refund' : undefined}><td>{r.date}</td><td>{r.marketplace||'â€”'}</td><td>{r.orderId||'â€”'}</td><td>{r.product||'â€”'}</td><td className="n">{r.qty}</td><td className="n">{money(r.unitCost)}</td><td className="n">{money(r.stockCost)}</td><td>{r.type}</td><td className="n">{money(r.amount)}</td></tr>):<tr><td colSpan="9" className="empty-cell muted">No transactions in this period.</td></tr>}</tbody></table></div>
 </div>;
}
