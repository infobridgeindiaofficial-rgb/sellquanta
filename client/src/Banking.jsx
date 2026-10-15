import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { api } from './api';
import { BANK_MARKETS, bankMoney, maskBankText, combineBankPreviews, settlementDetectionResults, updatePreviewRow } from './bankPreview';
import {validateManualReceipt} from './manualBankReceipt';
import {bankNetReceipts,REVERSAL_REASONS} from './bankNetReceipts';
import {bankingSummary} from './bankingSummary';

export default function Banking() {
  const [reverseTarget,setReverseTarget]=useState(null),[reverseReason,setReverseReason]=useState(''),[reverseConfirmed,setReverseConfirmed]=useState(false),[reversing,setReversing]=useState(false),[reverseError,setReverseError]=useState('');
  const reversingRef=useRef(false);
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [useOllama, setUseOllama] = useState(true);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [requestId, setRequestId] = useState('');
  const saveInFlight=useRef(false);
  const [history, setHistory] = useState({receipts:[],reconciliation:null});
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [salesState,setSalesState]=useState(null);
  const [summaryError,setSummaryError]=useState('');
  useEffect(()=>{
    let active=true,inFlight=false;
    const refresh=async()=>{
      if(inFlight)return;inFlight=true;
      try {const result=await api.state();if(active){setSalesState(result);setSummaryError('');}}
      catch {if(active)setSummaryError('Saved sales could not be loaded.');}
      finally {inFlight=false;}
    };
    refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  const [historyFilters, setHistoryFilters] = useState({marketplace:'',from:'',to:''});
  const [historyMode,setHistoryMode]=useState('month');
  const [historyMonth,setHistoryMonth]=useState('');
  const [manual,setManual]=useState({marketplace:'Amazon',date:'',amount:'',reference:'',notes:''});
  const [manualBusy,setManualBusy]=useState(false);
  const [manualMessage,setManualMessage]=useState('');
  const [manualError,setManualError]=useState('');
  const manualRequest=useRef('');
  const manualInFlight=useRef(false);
  const manualValidation=validateManualReceipt(manual);
  const changeManual=(key,value)=>{setManual(current=>({...current,[key]:value}));manualRequest.current='';setManualMessage('');setManualError('');};
  const saveManual=async event=>{
    event.preventDefault();
    if(manualInFlight.current||!manualValidation.valid)return;
    manualInFlight.current=true;setManualBusy(true);setManualError('');setManualMessage('');
    if(!manualRequest.current)manualRequest.current=crypto.randomUUID();
    try {
      const result=await api.saveManualBankReceipt({...manual,requestId:manualRequest.current});
      setHistory(result.history);setHistoryError('');setHistoryLoading(false);
      // Show the newly saved receipt even if an earlier history filter excluded it.
      setHistoryMode('month');setHistoryMonth('');setHistoryFilters({marketplace:'',from:'',to:''});
      setManualMessage('Manual bank receipt saved.');
      setManual(current=>({...current,date:'',amount:'',reference:'',notes:''}));manualRequest.current='';
    }catch(failure){setManualError(failure.message||'Manual receipt could not be saved. Retry without changing the fields.');}
    finally{manualInFlight.current=false;setManualBusy(false);}
  };
  useEffect(()=>{
    let active=true;
    const refresh=()=>api.bankReceiptHistory().then(result=>{if(active){setHistory(result);setHistoryError('');}}).catch(()=>{if(active)setHistoryError('Saved receipt history could not be loaded. Saving remains blocked.');}).finally(()=>{if(active)setHistoryLoading(false);});
    refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  const scan = async () => {
    setBusy(true); setError(''); setPreview(null);setVerified(false);setSaveResult(null);setRequestId(crypto.randomUUID());
    try {
      const { statementInput } = await import('./bankStatementFile.js');
      const scans = [];
      for (const file of files) scans.push(await api.bankStatementPreview({ ...await statementInput(file), useOllama }));
      setPreview(combineBankPreviews(scans));
    } catch (failure) { setError(failure.message || 'Statement scan failed. Nothing was saved.'); }
    finally { setBusy(false); }
  };
  const update = (id, action, marketplace) => {setVerified(false);setSaveResult(null);setRequestId(crypto.randomUUID());setPreview(current => ({ ...current, rows: current.rows.map(row => row.id === id ? updatePreviewRow(row, action, marketplace) : row) }));};
  const results = settlementDetectionResults(preview?.rows || []);
  const save=async()=>{
    if(!verified||saveInFlight.current||!preview?.savingEnabled||!results.confirmed.length)return;
    saveInFlight.current=true;
    setSaving(true);setError('');
    try {
      const result=await api.saveBankReceipts({confirm:true,verificationComplete:true,requestId,selections:results.confirmed.map(row=>({scanToken:row.scanToken,rowId:row.originalRowId,marketplace:row.marketplace,approved:true,classificationSource:row.classificationSource||(row.detection.marketplace===row.marketplace?'Rule':'Manual')}))});
      setSaveResult(result);setVerified(false);
      try {setHistory(await api.bankReceiptHistory());setHistoryError('');}
      catch {setHistoryError('Receipts were saved, but history refresh failed. Reload the page to read saved records.');}
    }catch(failure){setError(failure.message||'Save failed. Retry with the same verified selections; duplicate protection remains active.');}
    finally{saveInFlight.current=false;setSaving(false);}
  };
  const savedReceipts=history.receipts.filter(receipt=>{
    const date=String(receipt.date||'').slice(0,10);
    return (!historyFilters.marketplace||receipt.marketplace===historyFilters.marketplace)&&(historyMode==='month'?(!historyMonth||date.slice(0,7)===historyMonth):(!historyFilters.from||date>=historyFilters.from)&&(!historyFilters.to||date<=historyFilters.to));
  });
  const historyMonths=[...new Set(history.receipts.map(receipt=>String(receipt.date||'').slice(0,7)).filter(month=>/^\d{4}-\d{2}$/.test(month)))].sort().reverse();
  const savedTotals=BANK_MARKETS.map(marketplace=>({marketplace,cents:bankNetReceipts(history.receipts).filter(receipt=>receipt.marketplace===marketplace&&savedReceipts.some(row=>row.id===receipt.id)).reduce((sum,receipt)=>sum+receipt.amountCents,0)}));
  const reverse=async()=>{
    if(!reverseTarget||!reverseReason||!reverseConfirmed||reversingRef.current)return;
    reversingRef.current=true;setReversing(true);setReverseError('');
    try{const result=await api.reverseBankReceipt(reverseTarget.id,reverseReason);setHistory(result.history);setHistoryError('');setReverseTarget(null);setReverseReason('');setReverseConfirmed(false);}
    catch(failure){setReverseError(failure.message);}
    finally{reversingRef.current=false;setReversing(false);}
  };

  const summaryRows=bankingSummary(salesState||{},history.receipts);
  const marketplaceSelect = (row, action) => <select aria-label={`Marketplace for ${row.id}`} disabled={saving} value={row.marketplace || ''} onChange={event => update(row.id, action, event.target.value)}>
    <option value="">Choose marketplace</option>{BANK_MARKETS.map(market => <option key={market}>{market}</option>)}
  </select>;
  return <section className="banking-page" aria-label="Banking">
    {reverseTarget&&<div className="backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="reverse-receipt-title"><div className="ph"><h3 id="reverse-receipt-title">Reverse Bank Receipt</h3></div><div className="pb">
      <p>Marketplace: <b>{reverseTarget.marketplace}</b></p><p>Received Date: {reverseTarget.date}</p><p>Amount: {bankMoney(reverseTarget.amountCents)}</p><p>Bank Reference / UTR: {reverseTarget.reference||'?'}</p><p>Source: {reverseTarget.displaySource}</p><p>Original receipt ID: <span className="code">{reverseTarget.id}</span></p>
      <label>Reversal Reason<select aria-label="Reversal Reason" value={reverseReason} disabled={reversing} required onChange={e=>setReverseReason(e.target.value)}><option value="">Select reason</option>{REVERSAL_REASONS.map(reason=><option key={reason}>{reason}</option>)}</select></label>
      <label className="check-label"><input type="checkbox" checked={reverseConfirmed} disabled={reversing} onChange={e=>setReverseConfirmed(e.target.checked)}/>I confirm this reversal. Both the original receipt and the reversal will remain permanently saved.</label>
      {reverseError&&<p className="form-error" role="alert">{reverseError}</p>}
      <div className="inline"><button className="ghost" disabled={reversing} onClick={()=>setReverseTarget(null)}>Cancel</button><button className="danger" disabled={reversing||!reverseReason||!reverseConfirmed} onClick={reverse}>{reversing?'Reversing?':'Confirm Reversal'}</button></div>
    </div></div></div>}

    <div className="card flush banking-summary">
      <div className="ph"><h3>Marketplace Settlement Summary</h3><span className="meta">All-time cumulative ? saved records</span></div>
      <div className="banking-marketplace-cards" aria-label="All-time marketplace settlement summary">
        {summaryRows.map(row=><article key={row.marketplace} className={`banking-marketplace-card ${row.marketplace==='TOTAL'?'banking-total-card':''}`} aria-label={`${row.marketplace} settlement summary`}>
          <h4>{row.marketplace}</h4>
          <dl>
            <div><dt>{row.marketplace==='TOTAL'?'Total Estimated Settlement':'Estimated Settlement'}</dt><dd>{!salesState||summaryError?'Unavailable':row.estimatedCents===null?'Not available':bankMoney(row.estimatedCents)}</dd></div>
            <div><dt>{row.marketplace==='TOTAL'?'Total Bank Received':'Bank Received'}</dt><dd>{historyLoading||historyError?'Unavailable':bankMoney(row.receivedCents)}</dd></div>
            <div><dt>{row.marketplace==='TOTAL'?'Total Return Extra Charges':'Return Extra Charges'}</dt><dd>{!salesState||summaryError?'Unavailable':bankMoney(row.returnChargeCents)}</dd></div>
            <div className="banking-due"><dt>{row.marketplace==='TOTAL'?'Total Final Settlement Due':'Final Settlement Due'}</dt><dd>{!salesState||summaryError||historyLoading||historyError?'Unavailable':row.dueCents===null?'Not available':bankMoney(row.dueCents)}</dd></div>
          </dl>
        </article>)}
      </div>
      {summaryError&&<p className="note" role="alert">{summaryError}</p>}
      {salesState&&summaryRows.some(row=>row.missing>0)&&<p className="note">Some sales have no saved settlement estimate or valid Dashboard mapping. Their marketplace estimate and due remain unavailable.</p>}
    </div>
    <div className="card">
      <div className="section-head"><h3>Manual Bank Receipt</h3></div>
      <p className="muted" id="banking-manual-status">Record a marketplace credit using its received date, amount and bank reference / UTR.</p>
      <form className="banking-form" aria-describedby="banking-manual-status" onSubmit={saveManual}>
        <div className="form-grid">
          <label>Marketplace<select name="marketplace" required disabled={manualBusy} value={manual.marketplace} onChange={event=>changeManual('marketplace',event.target.value)}>{["Amazon", "Flipkart", "Meesho"].map(name => <option key={name}>{name}</option>)}</select></label>
          <label>Received Date<input name="receivedDate" type="date" required disabled={manualBusy} value={manual.date} onChange={event=>changeManual('date',event.target.value)}/></label>
          <label>Received Amount (INR)<input name="receivedAmount" type="number" min="0.01" step="0.01" placeholder="Enter amount" required disabled={manualBusy} value={manual.amount} onChange={event=>changeManual('amount',event.target.value)}/></label>
          <label>Bank Reference / UTR<input name="reference" type="text" placeholder="Enter bank reference or UTR" required maxLength={200} disabled={manualBusy} value={manual.reference} onChange={event=>changeManual('reference',event.target.value)}/></label>
          <label className="span2">Notes (optional)<textarea name="notes" rows="3" placeholder="Add receipt notes" maxLength={2000} disabled={manualBusy} value={manual.notes} onChange={event=>changeManual('notes',event.target.value)}/></label>
        </div>
        <div className="inline"><button type="submit" disabled={manualBusy||!manualValidation.valid}><Icon name="plus" />{manualBusy?'Saving…':'Save Receipt'}</button></div>
        {!manualValidation.valid&&<p className="field-note">{manualValidation.error}</p>}
        {manualError&&<p className="form-error" role="alert">{manualError}</p>}
        {manualMessage&&<p className="field-note" role="status">{manualMessage}</p>}
      </form>
    </div>

    <div className="card flush banking-scanner">
      <div className="ph"><h3>Bank Statement Scanner</h3><span className="badge warn">Verify before saving</span></div>
      <div className="banking-scanner-controls">
        <p className="muted" id="banking-scanner-status">Select one or more PDF, CSV or XLSX statements. Only confirmed Amazon, Flipkart and Meesho credits appear in the main results. Scanning never saves receipts.</p>
        <div className="banking-scan-toolbar">
        <label>Upload Bank Statements (PDF, CSV, XLSX)<input type="file" multiple accept=".pdf,.csv,.xlsx" disabled={busy||saving} aria-describedby="banking-scanner-status" onChange={event => { setFiles(Array.from(event.target.files || [])); setPreview(null); setError('');setVerified(false);setSaveResult(null); }} /></label>
        {files.length > 0 && <p className="field-note">{files.length} statement(s) selected</p>}
        <label className="check-label"><input type="checkbox" checked={useOllama} disabled={busy||saving} onChange={event => setUseOllama(event.target.checked)} />Ask local Ollama for advisory suggestions on uncertain credits</label>
        <div className="inline"><button type="button" disabled={!files.length || busy||saving} onClick={scan}><Icon name="scan" />{busy ? 'Scanning…' : 'Scan Statement'}</button><button type="button" disabled={!verified||saving||!preview?.savingEnabled||!results.confirmed.length||!!saveResult} onClick={save}><Icon name="check" />{saving?'Saving…':'Confirm & Save'}</button></div>
        </div>
        {preview&&<label className="check-label"><input type="checkbox" checked={verified} disabled={saving||!preview.savingEnabled||!results.confirmed.length||!!saveResult} onChange={event=>setVerified(event.target.checked)}/>I verified and approve these {results.confirmed.length} confirmed marketplace credits. Excluded and unconfirmed rows will not be saved.</label>}
        {saveResult&&<p role="status" className="field-note">Saved {saveResult.saved} receipt(s); skipped {saveResult.duplicates} duplicate(s). Receipt history is stored locally and persists after refresh.</p>}
        <div aria-live="polite">{busy && <p className="muted">Scanning locally. AI checks may take up to two minutes per statement.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div>
      </div>
      {preview && <div className="banking-preview-summary" aria-label="Scan Results summary">
        <h3>Scan Results</h3>
        <div className="inline">{results.summaries.map(group=><span className="badge" key={group.marketplace} data-marketplace={group.marketplace}>{group.marketplace}: <span className="stat-value">{bankMoney(group.cents)}</span> · {group.count} confirmed transaction(s)</span>)}</div>
        <div className="inline"><span className="badge saved">Confirmed: {results.confirmed.length}</span><span className="badge saved">Total received: {bankMoney(results.totalCents)}</span><span className="badge warn">Needs Review: {results.review.length}</span></div>
        <p className="field-note">{preview.reconciled ? 'Source transaction counts and credit totals reconciled.' : 'Extraction is not reconciled. Review source totals and parsing issues before trusting these results.'}</p>
        <p className="field-note">{results.hiddenCount} other or duplicate transaction(s) hidden from results, retained in extracted scan data. These are preview totals; saving requires explicit verification and Confirm &amp; Save.</p>
        {preview.warnings.length > 0 && <details open><summary>Extraction issues ({preview.warnings.length})</summary><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning.statementLabel}: {warning.message}</li>)}</ul></details>}
      </div>}
      <h3 className="sub-h">Detected Marketplace Credits</h3>
      <div className="table-wrap"><table aria-label="Detected marketplace credits"><thead><tr>
        {['Date', 'Marketplace', 'Bank Narration', 'Reference Number', 'Received Amount', 'Detection Status'].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{results.confirmed.length ? results.confirmed.map(row => <tr key={row.id}>
        <td>{row.date}<small className="banking-source">{row.statementLabel}</small></td>
        <td>{marketplaceSelect(row, 'correct')}</td><td className="wrap banking-narration">{maskBankText(row.narration)}</td>
        <td>{maskBankText(row.reference) || '—'}</td><td className="n">{bankMoney(row.creditCents)}</td>
        <td><span className="badge saved">{row.classificationSource === 'Manual' ? 'Manually corrected' : row.classificationSource === 'Ollama Suggested' ? 'User-confirmed AI suggestion' : 'Rule confirmed'}</span><button type="button" className="quiet sm" disabled={saving} onClick={() => update(row.id, 'review')}>Needs Review</button></td>
      </tr>) : <tr><td colSpan="6" className="muted empty-cell">{preview ? 'No confirmed marketplace credits detected.' : 'Upload statements and scan to see real detected marketplace credits.'}</td></tr>}</tbody></table></div>
    </div>
    <div className="card flush">
      <div className="ph"><h3>Needs Review</h3><span className="badge warn">{results.review.length}</span></div>
      <p className="note">Ambiguous credits, including INTERNAL A-DAS, are excluded from confirmed totals. Ollama suggestions are advisory; choose a marketplace and explicitly confirm the classification to include a credit in this preview.</p>
      {preview && <p className="banking-scanner-controls field-note">{preview.aiStatus}</p>}
      <div className="table-wrap"><table aria-label="Credits needing review"><thead><tr>
        {['Date', 'Bank Narration', 'Reference Number', 'Received Amount', 'Ollama Suggestion', 'Review Action'].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{results.review.length ? results.review.map(row => <tr key={row.id}>
        <td>{row.date}<small className="banking-source">{row.statementLabel}</small></td><td className="wrap banking-narration">{maskBankText(row.narration)}</td>
        <td>{maskBankText(row.reference) || '—'}</td><td className="n">{bankMoney(row.creditCents)}</td>
        <td className="wrap">{row.ai ? <>{row.ai.marketplace} ({Math.round(row.ai.confidence * 100)}%)<small>{maskBankText(row.ai.explanation)}</small><small>Advisory only</small></> : 'No suggestion — manual review required'}</td>
        <td><div className="banking-row-actions">{marketplaceSelect(row, 'marketplace')}
          {BANK_MARKETS.includes(row.ai?.marketplace) && <button type="button" className="ghost sm" disabled={saving} onClick={() => update(row.id, 'ai')}>Use suggestion</button>}
          <button type="button" className="sm" disabled={!row.marketplace||saving} onClick={() => update(row.id, 'confirmDetection')}>Confirm classification</button>
          <button type="button" className="ghost sm" disabled={saving} onClick={() => update(row.id, 'exclude')}>Exclude</button>
        </div></td>
      </tr>) : <tr><td colSpan="6" className="muted empty-cell">{preview ? 'No credits need review.' : 'Ambiguous credits will appear here after scanning.'}</td></tr>}</tbody></table></div>
    </div>

    <div className="card flush">
      <div className="ph"><h3>Bank Receipt History</h3><span className="badge saved">Saved records only</span></div>
      <div className="banking-scanner-controls form-grid">
        <label>History period<select value={historyMode} onChange={event=>setHistoryMode(event.target.value)}><option value="month">Month</option><option value="dateRange">Date Range</option></select></label>
        {historyMode==='month'&&<label>History month<select value={historyMonth} onChange={event=>setHistoryMonth(event.target.value)}><option value="">All months</option>{historyMonths.map(month=><option key={month}>{month}</option>)}</select></label>}
        <label>History marketplace<select value={historyFilters.marketplace} onChange={event=>setHistoryFilters(current=>({...current,marketplace:event.target.value}))}><option value="">All marketplaces</option>{BANK_MARKETS.map(market=><option key={market}>{market}</option>)}</select></label>
        {historyMode==='dateRange'&&<><label>History from date<input type="date" value={historyFilters.from} onChange={event=>setHistoryFilters(current=>({...current,from:event.target.value}))}/></label>
        <label>History to date<input type="date" value={historyFilters.to} onChange={event=>setHistoryFilters(current=>({...current,to:event.target.value}))}/></label></>}
        {historyMode==='dateRange'&&historyFilters.from&&historyFilters.to&&historyFilters.from>historyFilters.to&&<p className="form-error">From date must be before or equal to To date.</p>}
      </div>
      <div className="stats cols-3 banking-saved-totals" aria-label="Saved receipt totals">{savedTotals.map(total=><div className="card stat" key={total.marketplace}><div className="stat-label">{total.marketplace} saved</div><div className="stat-value">{bankMoney(total.cents)}</div><div className="muted">Selected history filters; includes retained active legacy receipts</div></div>)}</div>
      <div className="table-wrap"><table aria-label="Bank receipt history"><thead><tr>
        {["Date", "Marketplace", "Bank Reference / UTR", "Received Amount", "Entry Source", "Status", "Action"].map(label => <th key={label}>{label}</th>)}
      </tr></thead><tbody>{savedReceipts.length?savedReceipts.map((receipt,index)=><tr key={receipt.id||index} className={receipt.displayStatus==='Reversed'?'is-archived':receipt.displayStatus==='Reversal'?'bank-reversal-row':''}><td>{receipt.date}</td><td>{receipt.marketplace}</td><td>{maskBankText(receipt.reference)||'—'}</td><td className="n">{bankMoney(receipt.amountCents)}</td><td>{receipt.displaySource}</td><td><span className={`badge ${receipt.displayStatus==='Reversal'?'warn':'tag'}`}>{receipt.displayStatus}</span>{receipt.kind==='receipt_reversal'&&<small>Original receipt: {receipt.originalReceiptId}<br/>Reason: {receipt.reversalReason}</small>}<details><summary>Audit history</summary>{(history.audit||[]).filter(entry=>entry.settlementId===receipt.id).map((entry,i)=><div key={i}>{entry.action==='statement_import'?'Statement imported':maskBankText(entry.action)} · {maskBankText(entry.at)}</div>)}</details></td><td>{receipt.displayStatus==='Active'&&receipt.id&&<button type="button" className="quiet sm" disabled={reversing} onClick={()=>{setReverseTarget(receipt);setReverseReason('');setReverseConfirmed(false);setReverseError('');}}>Reverse</button>}</td></tr>):<tr><td colSpan="7" className="muted empty-cell">{historyLoading?'Loading saved receipts…':historyError?'History unavailable — no records were changed.':'No saved receipts match these filters.'}</td></tr>}</tbody></table></div>
      <p className="note">Saved receipt totals are separate from scan totals. Existing records are retained. Import audit records preserve source transactions and classification history; Dashboard calculations are unchanged.</p>
    </div>
  </section>;
}
