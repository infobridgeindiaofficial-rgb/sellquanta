const fields = ['listing_price', 'cost_price', 'estimated_settlement', 'estimated_profit'];
const norm = value => String(value ?? '').trim().toLowerCase();
const skuKey = value => norm(value).replace(/\s+/g, '');

// Never guess between multiple SKUs for the same PDN. Manual entries without a SKU
// can use a mapping only when that company/marketplace/warehouse product has one.
export function financialMapping(mappings, sale) {
  if (!sale.companyId || !sale.marketplace) return null;
  const sku = skuKey(sale.marketplaceSku);
  const matches = (mappings || []).filter(m => m.companyId === sale.companyId
    && norm(m.marketplace) === norm(sale.marketplace)
    && (!sale.productId || m.productId === sale.productId)
    && (sku ? skuKey(m.marketplaceSku) === sku : Boolean(sale.productId)));
  return matches.length === 1 ? matches[0] : null;
}
export function captureFinancialSnapshot(mapping, quantity, capturedAt = new Date().toISOString()) {
  const perUnit = Object.fromEntries(fields.map(field => [field,
    typeof mapping?.[field] === 'number' && Number.isFinite(mapping[field]) ? mapping[field] : null]));
  const totals = Object.fromEntries(fields.map(field => {
    const cents = perUnit[field] === null ? null : Math.round(perUnit[field] * 100) * quantity;
    return [field, cents !== null && Number.isSafeInteger(cents) ? cents / 100 : null];
  }));
  return { version: 1, capturedAt, mappingId: mapping?.id || null, quantity, perUnit, totals };
}
export function saleFinancials(sale, state) {
  if (sale.financialSnapshot) return { source: 'captured', snapshot: sale.financialSnapshot };
  const companyId = sale.companyId || (state.agents || []).find(a => a.id === sale.agentId)?.companyId || '';
  const mapping = financialMapping(state.productMaster, { ...sale, companyId });
  return { source: 'inferred', snapshot: captureFinancialSnapshot(mapping, sale.qty, null) };
}

export function estimatedFigures(sales, refunds, state, saleById) {
  const contributions = new Map();
  const add = (sale, quantity, key) => {
    if (!contributions.has(key)) contributions.set(key, { sale, quantity: 0 });
    contributions.get(key).quantity += quantity;
  };
  for (const sale of sales) add(sale, Number(sale.qty || 0), sale);
  for (const refund of refunds) {
    const original = saleById.get(refund.saleId);
    add(original || refund, -Number(refund.qty || 0), original || refund);
  }
  return Object.fromEntries(['estimated_settlement', 'estimated_profit'].map(field => {
    let cents = 0, missingQuantity = 0, capturedQuantity = 0, inferredQuantity = 0;
    for (const { sale, quantity } of contributions.values()) {
      if (!quantity) continue;
      const { source, snapshot } = saleFinancials(sale, state);
      const value = snapshot.perUnit?.[field];
      const total = typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) * quantity : null;
      if (total === null || !Number.isSafeInteger(total) || !Number.isSafeInteger(cents + total)) { missingQuantity += Math.abs(quantity); continue; }
      cents += total;
      if (source === 'captured') capturedQuantity += Math.abs(quantity); else inferredQuantity += Math.abs(quantity);
    }
    return [field, { amount: missingQuantity ? null : cents / 100, knownAmount: cents / 100, missingQuantity, capturedQuantity, inferredQuantity }];
  }));
}

// Reads only. Duplicate archive/open copies count once; refund copies and over-refunds
// cannot reverse more than the sale's quantity. Invoice amounts follow that same cap.
export function dashboardRecords(state) {
  const byId = new Map();
  for (const [index, sale] of [...(state.salesHistory || []), ...(state.todaySales || [])].entries()) {
    const key = sale.id || `unidentified:${index}`;
    if (!byId.has(key) || (!byId.get(key).financialSnapshot && sale.financialSnapshot)) byId.set(key, sale);
  }
  const sales = [...byId.values()], seen = new Set(), refunded = new Map(), refunds = [];
  const chronological = [...(state.refunds || [])].sort((a,b) => String(a.refundedAt || a.refundDate || '').localeCompare(String(b.refundedAt || b.refundDate || '')));
  for (const [index, refund] of chronological.entries()) {
    const key = refund.id || JSON.stringify([refund.saleId, refund.refundedAt, refund.refundDate, refund.qty, refund.refundAmount]) || index;
    if (seen.has(key)) continue;
    seen.add(key);
    const sale = byId.get(refund.saleId), requested = Number(refund.qty || 0);
    const qty = Math.max(0, sale ? Math.min(requested, Number(sale.qty || 0) - (refunded.get(sale.id) || 0)) : requested);
    if (!qty) continue;
    if (sale) refunded.set(sale.id, (refunded.get(sale.id) || 0) + qty);
    refunds.push(qty === requested ? refund : { ...refund, qty, refundAmount: Number(refund.refundAmount || 0) * qty / requested,
      costAmount: Number(refund.costAmount || 0) * qty / requested, dueReversalAmount: Number(refund.dueReversalAmount ?? refund.costAmount ?? 0) * qty / requested });
  }
  return { sales, refunds, saleById: byId };
}
