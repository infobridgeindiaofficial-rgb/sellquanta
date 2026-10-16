import React,{useRef,useState} from 'react';
import {api} from './api';
const money=c=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(c/100);
const readStatement=async file=>(await import('./bankStatementFile.js')).statementInput(file);
export default function StatementScanner({onSaved,readInput=readStatement}){
 const [file,setFile]=useState(null),[preview,setPreview]=useState(null),[choices,setChoices]=useState({}),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const pending=useRef(false),request=useRef(null);
 const [useOllama,setUseOllama]=useState(false);
 const run=async fn=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}};
 const scan=()=>run(async()=>{setPreview(null);setChoices({});setVerified(false);request.current=crypto.randomUUID();setPreview(await api.statementPreview({...await readInput(file),useOllama}));});
 const select=(row,patch)=>{setChoices(c=>({...c,[row.id]:{marketplace:row.detection.marketplace||'',approved:false,...c[row.id],...patch}}));request.current=crypto.randomUUID();};
 const selections=preview?.rows.filter(r=>choices[r.id]?.approved).map(r=>({scanToken:preview.scanToken,rowId:r.id,marketplace:choices[r.id].marketplace,classificationSource:choices[r.id].marketplace===r.detection.marketplace?'Rule':'Manual',approved:true}))||[];
 const save=()=>run(async()=>{const result=await api.statementImport({requestId:request.current,confirm:true,verificationComplete:verified,selections});setMessage(`Saved ${result.saved} receipt(s); skipped ${result.duplicates} duplicate(s).`);setChoices({});await onSaved?.();});
 return <section className="card" aria-label="Statement Scanner"><h3>Statement Scanner</h3><p>Preview PDF, CSV or XLSX statements. Only verified marketplace credits are saved to Banking; sales, refunds and stock stay unchanged.</p>
 <label>Bank statement<input aria-label="Bank statement" type="file" accept=".pdf,.csv,.xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setChoices({});setMessage('');setError('');}}/></label>
 <button disabled={busy||!file} onClick={scan}>Scan Statement</button>
 <label><input type="checkbox" checked={useOllama} disabled={busy} onChange={e=>setUseOllama(e.target.checked)}/>Request advisory verification from an already running local Ollama. Suggestions never save or approve transactions.</label>
 {preview&&<><p>{preview.aiStatus}</p><p>{preview.rows.length} extracted rows. {preview.savingEnabled?'Extraction reconciled.':preview.saveBlockedReason}</p><div className="table-wrap"><table aria-label="Statement preview"><thead><tr>{['Date','Narration / Reference','Credit','Status','Marketplace','Approve'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.map(row=>{const blocked=!!row.duplicate||row.debitCents!==0||row.creditCents<=0||row.detection.status==='Other / Excluded';return <tr key={row.id}><td>{row.date}</td><td>{row.narration}<small>{row.reference}</small></td><td>{money(row.creditCents)}</td><td>{row.duplicate||row.detection.status}</td><td><select aria-label={`Marketplace ${row.id}`} value={choices[row.id]?.marketplace??row.detection.marketplace??''} disabled={busy||blocked} onChange={e=>select(row,{marketplace:e.target.value,approved:false})}><option value="">Review marketplace</option>{['Amazon','Flipkart','Meesho'].map(m=><option key={m}>{m}</option>)}</select></td><td><input aria-label={`Approve ${row.id}`} type="checkbox" disabled={busy||blocked||!preview.savingEnabled||!(choices[row.id]?.marketplace||row.detection.marketplace)} checked={choices[row.id]?.approved||false} onChange={e=>select(row,{approved:e.target.checked})}/></td></tr>;})}</tbody></table></div>
 <label><input aria-label="Verify statement" type="checkbox" checked={verified} disabled={busy} onChange={e=>setVerified(e.target.checked)}/>I verified extraction, dates, amounts and selected marketplaces against the source statement.</label>
 <button disabled={busy||!verified||!preview.savingEnabled||!selections.length} onClick={save}>Confirm &amp; Save Receipts</button></>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</section>;
}
