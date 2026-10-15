import React,{useState} from 'react';
import {api} from './api';
import {Icon} from './icons';
import {salesReport,REPORT_COLUMNS} from './salesReport';
import {localToday} from './dashboardStats';
import ReportsBackup from './ReportsBackup';
import CompleteReset from './CompleteReset';

const money=value=>value===null?'Not available':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value);
export default function SalesReports({state,onBusinessReset}) {
 const today=localToday();
 const [selection,setSelection]=useState({mode:'daily',date:today,month:today.slice(0,7),from:today,to:today});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const change=(key,value)=>{setSelection(current=>({...current,[key]:value}));setError('');};
 let report,validation='';try{report=salesReport(state,selection);}catch(failure){validation=failure.message;}
 const exportExcel=async()=>{
  if(busy||!report)return;setBusy(true);setError('');
  try {const {blob,name}=await api.exportSalesReport(selection);const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(failure){setError(failure.message||'Export failed.');}finally{setBusy(false);}
 };
 return <section aria-label="Reports / Excel">
  <div className="card flush">
   <div className="ph"><h3>Sales Reports</h3><div className="acts"><button disabled={busy||!report||!report.rows.length} onClick={exportExcel}><Icon name="sheet" size={16}/>{busy?'Exporting…':'Export Excel'}</button></div></div>
   <div className="pb form-grid">
    <label>Report mode<select value={selection.mode} onChange={event=>change('mode',event.target.value)}>{[['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['custom','Custom Date Range']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {['daily','weekly'].includes(selection.mode)&&<label>{selection.mode==='daily'?'Report date':'Date in week (Monday–Sunday)'}<input type="date" value={selection.date} onChange={event=>change('date',event.target.value)}/></label>}
    {selection.mode==='monthly'&&<label>Month and year<input type="month" value={selection.month} onChange={event=>change('month',event.target.value)}/></label>}
    {selection.mode==='custom'&&<><label>From Date<input type="date" value={selection.from} onChange={event=>change('from',event.target.value)}/></label><label>To Date<input type="date" value={selection.to} onChange={event=>change('to',event.target.value)}/></label></>}
   </div>
   {validation&&<p className="note form-error" role="alert">{validation}</p>}
   {error&&<p className="note form-error" role="alert">{error}</p>}
   {report&&<>
    <p className="note">Selected period: {report.period.from} → {report.period.to}</p>
    <div className="summary-strip" aria-label="Report summary">{[['Total Orders',report.totals.orders],['Total Quantity',report.totals.qty],['Total Invoice Amount',money(report.totals.amount)],['Total Product Cost',money(report.totals.cost)],['Total Estimated Settlement',money(report.totals.settlement)],['Total Estimated Profit',money(report.totals.profit)]].map(([label,value])=><div className="ss" key={label}><div className="sl">{label}</div><div className="sv">{value}</div></div>)}</div>
    <div className="table-wrap scroll"><table aria-label="Sales report"><thead><tr>{REPORT_COLUMNS.map((label,index)=><th key={label} className={index>=5&&index<=9?'n':''}>{label}</th>)}</tr></thead><tbody>{report.records.length?report.records.map((record,index)=><tr key={report.rows[index].id||index}>{record.map((value,column)=><td key={column} className={column>=5&&column<=9?'n':''}>{column>=6&&column<=9?money(value):value}</td>)}</tr>):<tr><td colSpan="11" className="empty-cell muted">No saved sales in this period.</td></tr>}</tbody></table></div>
   </>}
  </div>
  <ReportsBackup />
  <CompleteReset onComplete={onBusinessReset} />
 </section>;
}
