import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {returnChargeTotals,RETURN_MARKETS} from './returnChargeTotals';
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n/100);
const fileBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read report.'));reader.readAsDataURL(file);});
export default function ReturnCharges({onSaved}){
 const [file,setFile]=useState(null),[preview,setPreview]=useState(null),[approved,setApproved]=useState([]),[records,setRecords]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const pending=useRef(false);
 const load=async()=>{const result=await api.returnChargeHistory();setRecords(result.records);};
 useEffect(()=>{let active=true;api.returnChargeHistory().then(result=>{if(active)setRecords(result.records);}).catch(failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[]);
 const scan=async()=>{
  if(!file||pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');setPreview(null);setApproved([]);
  try{if(file.size>20_000_000)throw Error('Report must be smaller than 20 MB.');setPreview(await api.scanReturnCharges({filename:file.name,base64:await fileBase64(file)}));}
  catch(failure){setError(failure.message);}finally{pending.current=false;setBusy(false);}
 };
 const save=async()=>{
  if(!preview||!approved.length||pending.current)return;pending.current=true;setBusy(true);setError('');
  try{const result=await api.saveReturnCharges({token:preview.token,approved,confirm:true});setApproved([]);setMessage(`Saved ${result.saved} charge(s); skipped ${result.duplicates} duplicate(s).`);await load();await onSaved?.();}
  catch(failure){setError(failure.message);}finally{pending.current=false;setBusy(false);}
 };
 const totals=returnChargeTotals(records);
 return <section className="return-charges-page" aria-label="Return Charges">
  <div className="card flush"><div className="ph"><h3>Return Charges</h3><span className="meta">Customer-return extra charges only</span></div>
   <div className="pb return-charge-actions"><div className="inline">
    <label>Upload report<input type="file" accept=".csv,.xlsx,.zip" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setApproved([]);setError('');setMessage('');}}/></label>
    <button disabled={busy||!file} onClick={scan}>{busy?'Working…':'Scan'}</button>
    <button disabled={busy||!approved.length} onClick={save}>Confirm &amp; Save</button>
   </div>
   <p className="field-note">Marketplace is auto-detected from report headers. Scanning does not save. Select only verified charges; Needs Review deductions require your explicit confirmation.</p>
   {preview&&<div className="return-charge-scan-summary" aria-label="Return charge scan summary"><span><small>Marketplace</small><b>{preview.marketplace}</b></span><span><small>Detected Extra Return Charges</small><b>{money(preview.totalCents)}</b></span><span><small>Needs Review</small><b>{preview.reviewCount} items / {money(preview.rows.filter(row=>row.status==='Needs Review').reduce((sum,row)=>sum+row.amountCents,0))}</b></span></div>}
   {error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status" className="field-note">{message}</p>}
   </div>
   <div className="table-wrap scroll return-charge-preview-scroll" tabIndex="0" aria-label="Scrollable return charge results"><table className="return-charge-preview" aria-label="Return charge preview"><thead><tr>{['Return Date','Marketplace','Order ID','SKU','Product','Extra Return Charge','Charge Type / Source Column','Detection Status','App Match Status','Refund Reason','Sales Record Found','Refund Record Found'].map(label=><th key={label} className={label==='Extra Return Charge'?'n':''}>{label}</th>)}</tr></thead><tbody>
    {preview?.rows.length?preview.rows.map(row=><tr key={row.id} className={row.status==='Confirmed'?'return-charge-confirmed':'return-charge-review'}><td>{row.date}<small>{row.dateBasis}</small></td><td>{row.marketplace}</td><td>{row.orderId}</td><td>{row.sku}</td><td className="wrap">{row.product}</td><td className="n">{money(row.amountCents)}</td><td>{row.chargeSource}<small>{row.returnStatus}</small></td><td className="wrap"><span className={`badge ${row.status==='Confirmed'?'saved':'warn'}`}>{row.status}</span><small>{row.reason}</small><label className="check-label"><input type="checkbox" disabled={busy||row.status==='Duplicate'||!row.orderId||!row.date} checked={approved.includes(row.id)} onChange={e=>setApproved(current=>e.target.checked?[...current,row.id]:current.filter(id=>id!==row.id))}/>I confirm this extra return charge</label></td><td><span className={`badge ${row.appMatchStatus==='Matched'?'saved':'warn'}`}>{row.appMatchStatus||'Needs Review'}</span></td><td>{row.refundReason||'Not recorded'}</td><td>{row.salesRecordFound?'Yes':'No / Missing Sale'}</td><td>{row.refundRecordFound?'Yes':'No'}</td></tr>):<tr><td colSpan="12" className="empty-cell muted">{preview?'No extra return charges detected.':'Upload and scan a marketplace report.'}</td></tr>}
   </tbody></table></div>
  </div>
  <div className="card flush"><div className="ph"><h3>Return Charges Ledger</h3><span className="meta">All-time confirmed records</span></div>
   <div className="summary-strip">{[...RETURN_MARKETS,'TOTAL'].map(market=><div className="ss" key={market}><span className="sl">{market==='TOTAL'?'Overall Total Extra Return Charges':market}</span><b className="sv">{money(totals[market])}</b></div>)}</div>
   <div className="table-wrap scroll"><table aria-label="Return charges ledger"><thead><tr>{['Date','Marketplace','Order ID','SKU','Product','Extra Return Charge','Source','Imported Date'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{records.length?[...records].reverse().map(row=><tr key={row.id}><td>{row.date}</td><td>{row.marketplace}</td><td>{row.orderId}</td><td>{row.sku}</td><td className="wrap">{row.product}</td><td className="n">{money(row.amountCents)}</td><td>{row.chargeSource}<small>{row.sourceFile} · {row.sourceSheet} row {row.sourceRow}</small></td><td>{row.importedAt}</td></tr>):<tr><td colSpan="8" className="empty-cell muted">No confirmed return charges saved.</td></tr>}</tbody></table></div>
  </div>
 </section>;
}
