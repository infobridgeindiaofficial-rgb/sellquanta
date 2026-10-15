import React, {useState} from 'react';
import {productReturnAnalysis} from './productReturnReport.js';

const money = cents => new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'}).format(cents / 100);
const percent = value => value === null ? '—' : `${value.toFixed(2)}%`;
export default function ProductReturnAnalysis({state, options}) {
  const [marketplace, setMarketplace] = useState('All');
  const {rows, review, summary:s} = productReturnAnalysis(state, options, marketplace);
  return <section className="card flush product-return-analysis" aria-label="Product-wise Return Analysis">
    <div className="ph"><h3>Product-wise Return Analysis</h3><label className="check-label">Marketplace
      <select className="compact" aria-label="Return analysis marketplace" value={marketplace} onChange={e=>setMarketplace(e.target.value)}>
        {['All','Amazon','Flipkart','Meesho'].map(m=><option key={m}>{m}</option>)}
      </select></label></div>
    <div className="summary-strip return-analysis-summary">{[
      ['Total Sold Quantity',s.sold], ['Total Customer Returns',s.customerReturns], ['Overall Customer Return %',percent(s.returnPercentage)],
      ['Total Refund Amount',s.missingRefunds ? 'Not available' : money(s.refundCents)],
      ['Total Confirmed Return Extra Charges',s.missingCharges ? 'Not available' : money(s.confirmedChargeCents)]
    ].map(([label,value])=><div className="ss" key={label}><span className="sl">{label}</span><b className="sv">{value}</b></div>)}</div>
    <div className="table-wrap"><table aria-label="Product return report"><thead><tr>
      {['Product Name','Marketplace','Total Sold Quantity','Customer Return Quantity','Return Percentage','Refund Amount (₹)','Return Extra Charges (₹)'].map((h,i)=><th key={h} className={i>1?'n':undefined}>{h}</th>)}
    </tr></thead><tbody>{rows.length ? rows.map(r=><tr key={r.key}>
      <td className="strong">{r.productName}<small className="return-product-code">{r.code || (!r.productId ? 'Needs mapping review' : '')}</small>
        {(r.rto>0 || r.cancelled>0 || r.unclassified>0) && <small className="return-product-code">RTO: {r.rto} · Cancelled: {r.cancelled} · Unclassified: {r.unclassified}</small>}</td>
      <td>{r.marketplace}</td><td className="n">{r.sold}</td><td className="n">{r.customerReturns}</td>
      <td className="n"><span className={`return-rate${r.returnPercentage>=20?' elevated':''}`} title="Customer returns divided by sold quantity; 20% and above is highlighted">{percent(r.returnPercentage)}</span></td>
      <td className="n">{r.missingRefunds ? 'Not available' : money(r.refundCents)}</td><td className="n">{money(r.chargeCents)}</td>
    </tr>) : <tr><td colSpan="7" className="empty-cell muted">No sales, refunds or matched charges in this period.</td></tr>}</tbody></table></div>
    {!!review.length && <details className="return-analysis-review"><summary>Unmatched / Needs Review ({review.length})</summary>
      <div className="table-wrap"><table aria-label="Return charges needing review"><thead><tr><th>Date</th><th>Marketplace</th><th>Order ID</th><th>SKU / Product</th><th className="n">Saved charge</th><th>Review reason</th></tr></thead>
        <tbody>{review.map((r,i)=><tr key={r.id || i}><td>{r.date}</td><td>{r.marketplace}</td><td>{r.orderId || '—'}</td><td>{r.sku || r.product || '—'}</td><td className="n">{Number.isSafeInteger(r.amountCents) && r.amountCents>=0 ? money(r.amountCents) : 'Not available'}</td><td className="wrap">{r.reviewReason}</td></tr>)}</tbody></table></div>
    </details>}
  </section>;
}
