import React,{useRef,useState} from 'react';
import {api} from './api';
import {localToday} from './dashboardStats';
import {validatePurchase,calculatePurchaseCost,totalPurchaseCents,purchaseTotalCents} from '../../server/purchaseLedger.mjs';

export const purchaseDisplayCents=purchaseTotalCents;
const money=cents=>cents===null?'Not available':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(cents/100);
export default function PurchaseLedger({state,reload}) {
 const empty=()=>({date:localToday(),supplier:'',product:'',quantity:'',costPrice:'',notes:''});
 const [form,setForm]=useState(empty),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const pending=useRef(false),request=useRef('');
 let valid=true,calculatedTotal=null;try{validatePurchase(form);}catch{valid=false;}
 try{calculatedTotal=calculatePurchaseCost(form.quantity,form.costPrice).totalCents;}catch{}
 const change=(field,value)=>{setForm(current=>({...current,[field]:value}));request.current='';setMessage('');setError('');};
 const save=async event=>{
  event.preventDefault();if(!valid||pending.current)return;pending.current=true;setBusy(true);setError('');
  if(!request.current)request.current=crypto.randomUUID();
  try {await api.savePurchase({...form,requestId:request.current});setForm(empty());request.current='';setMessage('Purchase saved.');await reload();}
  catch(failure){setError(failure.message||'Purchase could not be saved.');}finally{pending.current=false;setBusy(false);}
 };
 const purchases=state.purchases||[];
 const totalCents=totalPurchaseCents(purchases);
 return <section aria-label="Purchase Ledger">
  <div className="card flush">
   <div className="ph"><h3>Purchase Ledger</h3><div className="purchase-ledger-total"><span>Total Purchase Amount</span><b>{money(totalCents)}</b></div></div>
   <form className="pb" onSubmit={save}>
    <div className="form-grid">
     <label>Purchase Date<input name="date" type="date" required disabled={busy} value={form.date} onChange={e=>change('date',e.target.value)}/></label>
     <label>Supplier (optional)<input name="supplier" maxLength={200} disabled={busy} value={form.supplier} onChange={e=>change('supplier',e.target.value)}/></label>
     <label>Product<input name="product" required maxLength={300} disabled={busy} value={form.product} onChange={e=>change('product',e.target.value)}/></label>
     <label>Quantity<input name="quantity" type="number" min="1" step="1" required disabled={busy} value={form.quantity} onChange={e=>change('quantity',e.target.value)}/></label>
     <label>Cost Price (per unit)<input name="costPrice" type="number" min="0.01" step="0.01" required disabled={busy} value={form.costPrice} onChange={e=>change('costPrice',e.target.value)}/></label>
     <label>Notes (optional)<input name="notes" maxLength={2000} disabled={busy} value={form.notes} onChange={e=>change('notes',e.target.value)}/></label>
    </div>
    <label style={{display:'block',marginTop:12}}>Total Purchase Amount<input name="totalPurchaseAmount" readOnly value={calculatedTotal===null?'Not available':money(calculatedTotal)} style={{fontSize:20,fontWeight:700}}/></label>
    <div className="inline" style={{marginTop:12}}><button type="submit" disabled={busy||!valid}>{busy?'Saving…':'Save Purchase'}</button></div>
    {message&&<p className="field-note" role="status">{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
   </form>
   <div className="table-wrap scroll"><table aria-label="Purchase history"><thead><tr>{['Date','Supplier','Product','Quantity','Cost Price','Total Purchase Amount'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{purchases.length?[...purchases].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt).localeCompare(String(a.createdAt))).map(row=><tr key={row.id}><td>{row.date}</td><td>{row.supplier}</td><td>{row.product}</td><td className="n">{row.quantity}</td><td className="n">{money(Number.isSafeInteger(row.costPriceCents)&&row.costPriceCents>=0?row.costPriceCents:null)}</td><td className="n">{money(purchaseDisplayCents(row))}</td></tr>):<tr><td colSpan="6" className="empty-cell muted">No purchases saved.</td></tr>}</tbody></table></div>
  </div>
 </section>;
}
