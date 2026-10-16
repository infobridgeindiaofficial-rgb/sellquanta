const inDateRange=(day,from,to)=>(!from||day>=from)&&(!to||day<=to);
import {saleDay, refundDay, monthOptions} from './dashboardStats.js';

const norm = value => String(value ?? '').trim().toLowerCase();
const markets = ['Amazon', 'Flipkart', 'Meesho'];
const market = value => markets.find(m => norm(m) === norm(value)) || String(value || 'Unknown');
const unique = records => [...new Map(records.map(r => [r.id || JSON.stringify(r), r])).values()];
const cents = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;
const percentage = (returns, sold) => sold > 0 ? returns / sold * 100 : null;
const chargeDayOf = charge => String(charge.date || '').slice(0,10);
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));

// Include expense-only months without changing the selected period or KPI formulas.
export function dashboardReturnMonths(state) {
  return [...new Set([...monthOptions(state), ...(state.returnCharges || [])
    .filter(c => c.status === 'Confirmed' && validDay(chargeDayOf(c)))
    .map(c => chargeDayOf(c).slice(0,7))])].sort().reverse();
}

// Independent, read-only period report: sales by sale date, refunds by refund date,
// and charges by their saved expense date. No financial transactions are inferred.
export function productReturnAnalysis(state, options = {}, marketplace = 'All') {
  const archives = state.monthCloseArchive || [];
  const sales = unique([...(state.salesHistory || []), ...(state.todaySales || []), ...archives.flatMap(a => a.sales || [])]);
  const refunds = unique([...(state.refunds || []), ...archives.flatMap(a => a.refunds || [])]);
  const saleById = new Map(sales.map(s => [s.id, s]));
  const products = state.products || [], mappings = state.productMaster || [];
  const companyOf = r => r.companyId || (state.agents || []).find(a => a.id === r.agentId)?.companyId;
  const inPeriod = day => !!day && (options.fromDate || options.toDate
    ? inDateRange(day, options.fromDate, options.toDate) : !options.month || day.slice(0, 7) === options.month);
  const inMarket = value => marketplace === 'All' || market(value) === marketplace;
  function productOf(record) {
    if (record.productId) return products.find(p => p.id === record.productId) || {id:record.productId, name:record.productName, sku:record.warehouseProductCode};
    if (record.warehouseProductCode) {
      const found = products.filter(p => norm(p.sku) === norm(record.warehouseProductCode));
      if (found.length === 1) return found[0];
      return null;
    }
    const company = companyOf(record), sku = norm(record.marketplaceSku || record.sku);
    if (!company || !sku) return null;
    const ids = new Set(mappings.filter(m => m.companyId === company && market(m.marketplace) === market(record.marketplace)
      && norm(m.marketplaceSku) === sku).map(m => m.productId).filter(Boolean));
    return ids.size === 1 ? products.find(p => p.id === [...ids][0]) || null : null;
  }
  const groups = new Map();
  function group(record) {
    const product = productOf(record), marketplace = market(record.marketplace);
    const key = JSON.stringify([product?.id || `unresolved:${record.id || JSON.stringify(record)}`, marketplace]);
    if (!groups.has(key)) groups.set(key, {key, productId:product?.id, productName:product?.name || record.productName || 'Unmapped product', code:product?.sku || record.warehouseProductCode || '', marketplace,
      sold:0, customerReturns:0, rto:0, cancelled:0, unclassified:0, refundCents:0, missingRefunds:0, chargeCents:0});
    return groups.get(key);
  }
  for (const sale of sales) if (inPeriod(saleDay(sale)) && inMarket(sale.marketplace)) group(sale).sold += Number(sale.qty || 0);
  for (const refund of refunds) {
    const original = saleById.get(refund.saleId);
    const record = {...original, ...refund, productId:refund.productId || original?.productId, marketplace:refund.marketplace || original?.marketplace};
    if (!inPeriod(refundDay(refund)) || !inMarket(record.marketplace)) continue;
    const g = group(record), qty = Number(refund.qty || 0);
    const field = {'Customer Return':'customerReturns', RTO:'rto', Cancelled:'cancelled'}[refund.refundReason] || 'unclassified';
    g[field] += qty;
    const amount = cents(refund.refundAmount);
    if (amount === null) g.missingRefunds++; else g.refundCents += amount;
  }
  const review = [], outsidePeriod = [], seenIds = new Set(), seenKeys = new Set();
  let confirmedChargeCents = 0, missingCharges = 0;
  for (const charge of state.returnCharges || []) {
    if (charge.status === 'Duplicate' || !inMarket(charge.marketplace)) continue;
    const chargeDay = chargeDayOf(charge);
    const validDate = validDay(chargeDay);
    const fingerprint = charge.duplicateKey || JSON.stringify([market(charge.marketplace),norm(charge.orderId),norm(charge.sku),charge.transactionId || '',charge.date,charge.chargeSource || '',charge.amountCents]);
    if ((charge.id && seenIds.has(charge.id)) || seenKeys.has(fingerprint)) continue;
    if (charge.id) seenIds.add(charge.id); seenKeys.add(fingerprint);
    if (!validDate) {review.push({...charge, reviewReason:'Missing usable charge date; excluded from period totals'});continue;}
    if (!inPeriod(chargeDay)) {
      if (charge.status === 'Confirmed') outsidePeriod.push({id:charge.id, date:chargeDay});
      continue;
    }
    const validAmount = Number.isSafeInteger(charge.amountCents) && charge.amountCents >= 0;
    if (charge.status === 'Confirmed') { if (validAmount) confirmedChargeCents += charge.amountCents; else missingCharges++; }
    let reason = charge.status !== 'Confirmed' ? 'Charge is not confirmed' : !validAmount ? 'Missing or invalid saved amount' : '';
    const candidates = charge.orderId ? sales.filter(s => norm(s.orderId) === norm(charge.orderId) && market(s.marketplace) === market(charge.marketplace)
      && (!charge.companyId || companyOf(s) === charge.companyId)
      && (!charge.sku || norm(s.marketplaceSku || s.sku) === norm(charge.sku)
        || mappings.some(m => m.companyId === companyOf(s) && market(m.marketplace) === market(s.marketplace)
          && m.productId === productOf(s)?.id && norm(m.marketplaceSku) === norm(charge.sku)))
      && (!charge.productId || productOf(s)?.id === charge.productId)
      && (!charge.warehouseProductCode || norm(productOf(s)?.sku) === norm(charge.warehouseProductCode))) : [];
    const identities = new Set(candidates.map(s => productOf(s)?.id).filter(Boolean));
    if (!reason && (!candidates.length || candidates.some(s => !productOf(s)) || identities.size !== 1)) reason = 'No unique order / marketplace / product match';
    if (reason) review.push({...charge, reviewReason:reason});
    else group(candidates[0]).chargeCents += charge.amountCents;
  }
  const rows = [...groups.values()].map(g => ({...g, returnPercentage:percentage(g.customerReturns,g.sold)}))
    .sort((a,b) => (b.returnPercentage ?? -1) - (a.returnPercentage ?? -1) || a.productName.localeCompare(b.productName));
  const total = rows.reduce((t,r) => {for (const key of ['sold','customerReturns','rto','cancelled','unclassified','refundCents','missingRefunds']) t[key] += r[key];return t;},
    {sold:0,customerReturns:0,rto:0,cancelled:0,unclassified:0,refundCents:0,missingRefunds:0});
  return {rows, review, outsidePeriod, summary:{...total, returnPercentage:percentage(total.customerReturns,total.sold), confirmedChargeCents, missingCharges}};
}
