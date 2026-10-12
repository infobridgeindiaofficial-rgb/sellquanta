import { reportRange } from './reports.mjs';
const norm = v => String(v ?? '').trim().toLowerCase();
export function purchaseHistory(db, filter = {}) {
  const range = reportRange(filter), query = norm(filter.product), invoice = norm(filter.invoice), returned = db.purchaseReturns || [];
  return { range, lines:(db.purchases || []).filter(p => p.date >= range.from && p.date <= range.to && (!filter.supplierId || p.supplierId === filter.supplierId) && (!invoice || norm(p.invoiceNumber).includes(invoice))).flatMap(p => p.lines.filter(l => !query || [l.sku,l.productName].some(v => norm(v).includes(query))).map(l => {const returnQty = returned.filter(r => r.lineId === l.id).reduce((n,r) => n+r.qty,0); return {...l,purchaseId:p.id,date:p.date,supplierId:p.supplierId,supplierName:p.supplierName,invoiceNumber:p.invoiceNumber,returnedQty:returnQty,status:returnQty === l.qty ? 'Returned' : returnQty ? 'Partially returned' : 'Received'};})).sort((a,b) => b.date.localeCompare(a.date)) };
}
