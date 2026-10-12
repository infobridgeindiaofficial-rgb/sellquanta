import crypto from 'node:crypto';
export { purchaseHistory } from './purchaseReport.mjs';

const text = v => String(v ?? '').trim();
const norm = v => text(v).toLowerCase();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function required(v, label, max = 200) { const value = text(v); if (!value || value.length > max) throw fail(`${label} is required (maximum ${max} characters).`); return value; }
function integer(v, label, minimum = 0) { if (text(v) === '') throw fail(`${label} is required.`); const n = Number(v); if (!Number.isSafeInteger(n) || n < minimum) throw fail(`${label} must be a whole number of ${minimum} or more.`); return n; }
function cents(v) { if (!/^\d+(\.\d{1,2})?$/.test(text(v))) throw fail('Unit cost must be a non-negative amount with at most two decimal places.'); const n = Math.round(Number(v) * 100); if (!Number.isSafeInteger(n)) throw fail('Unit cost is too large.'); return n; }
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const purchaseState = db => ({ suppliers: db.suppliers || [], purchases: db.purchases || [], purchaseReturns: db.purchaseReturns || [] });
function init(db) { for (const key of ['suppliers','purchases','purchaseReturns','purchaseRequests']) db[key] ||= []; }
function findSupplier(db, name) { return (db.suppliers || []).find(s => [s.name, ...(s.aliases || [])].some(n => norm(n) === norm(name))); }
function normalizeInvoice(db, raw) {
  if (!raw || typeof raw !== 'object') throw fail('Purchase invoice details are required.');
  const date = text(raw.date); if (!validDate(date)) throw fail('Choose a valid purchase date.');
  const supplierName = required(raw.supplierName, 'Supplier name');
  const supplier = raw.supplierId ? (db.suppliers || []).find(s => s.id === raw.supplierId) : findSupplier(db, supplierName);
  if (raw.supplierId && !supplier) throw fail('Supplier not found.');
  const invoiceNumber = required(raw.invoiceNumber, 'Invoice number');
  if (!Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > 1000) throw fail('Add between 1 and 1000 purchase lines.');
  const seen = new Set();
  const lines = raw.lines.map(line => {
    const sku = required(line.sku, 'Warehouse Product Code');
    if (seen.has(norm(sku))) throw fail(`Duplicate product ${sku} within this invoice. Combine its quantity into one line.`);
    seen.add(norm(sku));
    const product = db.products.find(p => norm(p.sku) === norm(sku));
    if (product?.active === false) throw fail(`Product ${sku} is archived; its permanent code cannot be reused.`);
    if (line.productId && line.productId !== product?.id) throw fail('Selected product does not match its product code.');
    const name = product ? product.name : required(line.name, 'Product name');
    const qty = integer(line.qty, 'Quantity', 1), unitCostCents = cents(line.unitCost);
    const totalCents = qty * unitCostCents;
    if (!Number.isSafeInteger(totalCents)) throw fail('Purchase amount is too large.');
    const lowStockLevel = integer(line.lowStockLevel ?? product?.lowStockLevel ?? 5, 'Low Stock Alert');
    const image = text(line.image);
    if (image && (image.length > 200000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))) throw fail('Product image must be a small PNG, JPEG or WebP image.');
    const notes = text(line.notes || raw.notes); if (notes.length > 2000) throw fail('Purchase notes are limited to 2000 characters.');
    return { sku: product?.sku || sku, name, qty, unitCostCents, totalCents, lowStockLevel, image, notes };
  });
  if (!Number.isSafeInteger(lines.reduce((n,l) => n + l.totalCents, 0))) throw fail('Invoice amount is too large.');
  return { date, supplierId: supplier?.id || '', supplierName: supplier?.name || supplierName, invoiceNumber, lines };
}
function requestKey(value) { if (!/^[A-Za-z0-9_-]{16,128}$/.test(text(value))) throw fail('A valid request ID is required. Retry from the same purchase form.'); return text(value); }
export function preparePurchases(db, invoices) {
  if (!Array.isArray(invoices) || !invoices.length || invoices.length > 1000) throw fail('Provide between 1 and 1000 invoices.');
  const result = invoices.map(i => normalizeInvoice(db, i)), seen = new Set();
  for (const i of result) {
    const key = (i.supplierId || norm(i.supplierName)) + '|' + norm(i.invoiceNumber);
    if (seen.has(key)) throw fail(`Duplicate invoice ${i.invoiceNumber} in this request.`);
    seen.add(key);
    if ((db.purchases || []).some(p => (i.supplierId ? p.supplierId === i.supplierId : norm(p.supplierName) === norm(i.supplierName)) && norm(p.invoiceNumber) === norm(i.invoiceNumber))) throw fail(`Invoice ${i.invoiceNumber} is already recorded for this supplier.`, 409);
  }
  return result;
}
// Called only inside the existing synchronous store transaction. Validation completes before any stock changes.
export function receivePurchases(db, { requestId, invoices, source = 'manual' }) {
  const key = requestKey(requestId);
  const fingerprint = digest(invoices);
  const prior = (db.purchaseRequests || []).find(r => r.key === key);
  if (prior) { if (prior.fingerprint !== fingerprint || prior.kind !== 'purchase') throw fail('Request ID was already used with different purchase details.', 409); return { replayed: true, purchases: prior.ids.map(i => db.purchases.find(p => p.id === i)) }; }
  const prepared = preparePurchases(db, invoices);
  // Check cumulative stock additions (including multiple invoices for the same product).
  const stocks = new Map(db.products.map(p => [norm(p.sku), Number(p.stock)]));
  for (const invoice of prepared) for (const line of invoice.lines) { const existing = stocks.has(norm(line.sku)) ? stocks.get(norm(line.sku)) : 0; if (!Number.isSafeInteger(existing) || existing < 0) throw fail(`Current stock for ${line.sku} is invalid.`); const stock = existing + line.qty; if (!Number.isSafeInteger(stock)) throw fail(`Stock for ${line.sku} is too large.`); stocks.set(norm(line.sku), stock); }
  init(db); const createdAt = new Date().toISOString(), purchases = [];
  for (const invoice of prepared) {
    let supplier = invoice.supplierId ? db.suppliers.find(s => s.id === invoice.supplierId) : findSupplier(db, invoice.supplierName);
    if (!supplier) { supplier = { id: id('supplier'), name: invoice.supplierName, phone:'', address:'', gstin:'', createdAt }; db.suppliers.push(supplier); }
    const purchase = { id:id('purchase'), date:invoice.date, supplierId:supplier.id, supplierName:supplier.name, invoiceNumber:invoice.invoiceNumber, source, createdAt, lines:[], totalCents:0 };
    for (const line of invoice.lines) {
      let product = db.products.find(p => norm(p.sku) === norm(line.sku));
      if (!product) { product = { id:id('prod'), sku:line.sku, name:line.name, stock:0, costPrice:line.unitCostCents/100, image:line.image, lowStockLevel:line.lowStockLevel, createdAt }; db.products.push(product); }
      product.stock = Number(product.stock) + line.qty; product.costPrice = line.unitCostCents/100; product.lowStockLevel = line.lowStockLevel;
      if (line.image) product.image = line.image;
      product.updatedAt = createdAt;
      const saved = { ...line, id:id('purchase_line'), productId:product.id, productName:product.name, unitCost:line.unitCostCents/100, totalCost:line.totalCents/100 };
      delete saved.image; purchase.lines.push(saved); purchase.totalCents += line.totalCents;
      db.stockMovements.push({ id:id('mov'), date:invoice.date, productId:product.id, type:'PURCHASE', qty:line.qty, unitCost:saved.unitCost, purchaseId:purchase.id, purchaseLineId:saved.id, supplierId:supplier.id, note:`Purchase invoice ${invoice.invoiceNumber}`, createdAt });
    }
    db.purchases.push(purchase); purchases.push(purchase);
  }
  db.purchaseRequests.push({ key, fingerprint, kind:'purchase', ids:purchases.map(p => p.id), createdAt });
  return { replayed:false, purchases };
}
export function saveSupplier(db, body, supplierId) {
  const name = required(body.name,'Supplier name'), phone = text(body.phone), address = text(body.address), gstin = text(body.gstin).toUpperCase();
  if (phone.length > 50 || address.length > 1000 || (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin))) throw fail('Check supplier phone, address and GSTIN.');
  const same = findSupplier(db,name); if (same && same.id !== supplierId) throw fail('Supplier name already exists.',409);
  const existing = supplierId && (db.suppliers || []).find(s => s.id === supplierId); if (supplierId && !existing) throw fail('Supplier not found.',404);
  init(db); const supplier = existing || {id:id('supplier'),createdAt:new Date().toISOString()};
  if (existing && norm(existing.name) !== norm(name)) supplier.aliases = [...new Set([...(supplier.aliases || []), existing.name])];
  Object.assign(supplier,{name,phone,address,gstin,updatedAt:new Date().toISOString()}); if (!existing) db.suppliers.push(supplier); return supplier;
}
export function returnPurchase(db, body) {
  const key = requestKey(body.requestId), date = text(body.date || today()); if (!validDate(date)) throw fail('Choose a valid return date.');
  const qty = integer(body.qty,'Return quantity',1), notes = text(body.notes); if (notes.length > 2000) throw fail('Return notes are limited to 2000 characters.');
  const fingerprint = digest({lineId:body.lineId,qty,date,notes});
  const prior = (db.purchaseRequests || []).find(r => r.key === key);
  if (prior) { if (prior.kind !== 'return' || prior.fingerprint !== fingerprint) throw fail('Return request ID already used with different details.',409); return {replayed:true,return:db.purchaseReturns.find(r => r.id === prior.ids[0])}; }
  const purchase = (db.purchases || []).find(p => p.lines.some(l => l.id === body.lineId));
  const line = purchase?.lines.find(l => l.id === body.lineId); if (!line) throw fail('Original purchase line not found.',404);
  if (date < purchase.date) throw fail('Return date cannot precede the purchase date.');
  const returned = (db.purchaseReturns || []).filter(r => r.lineId === line.id).reduce((n,r) => n + r.qty,0);
  if (qty > line.qty - returned) throw fail('Return exceeds the remaining eligible purchase quantity.');
  const product = db.products.find(p => p.id === line.productId); if (!product || product.active === false) throw fail('The original product is unavailable or archived.');
  if (!Number.isSafeInteger(Number(product.stock)) || product.stock < qty) throw fail('Not enough current warehouse stock for this return.');
  init(db); const createdAt = new Date().toISOString();
  const record = {id:id('purchase_return'),purchaseId:purchase.id,lineId:line.id,productId:line.productId,sku:line.sku,productName:line.productName,supplierId:purchase.supplierId,supplierName:purchase.supplierName,invoiceNumber:purchase.invoiceNumber,date,qty,unitCost:line.unitCost,totalCents:line.unitCostCents*qty,notes,createdAt};
  product.stock -= qty; // Retain current valuation cost, and all historical purchase/sale cost snapshots.
  db.purchaseReturns.push(record);
  db.stockMovements.push({id:id('mov'),date,productId:product.id,type:'PURCHASE_RETURN',qty:-qty,purchaseId:purchase.id,purchaseLineId:line.id,purchaseReturnId:record.id,unitCost:line.unitCost,note:`Purchase return ${purchase.invoiceNumber}`,createdAt});
  db.purchaseRequests.push({key,fingerprint,kind:'return',ids:[record.id],createdAt}); return {replayed:false,return:record};
}
