const markets = ['Amazon', 'Flipkart', 'Meesho'];
const market = value => markets.find(m => m.toLowerCase() === String(value ?? '').trim().toLowerCase());
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ''));
const cents = value => Number.isSafeInteger(value) && value > 0;

// Check if a date string (YYYY-MM-DD) falls within [fromDate, toDate] inclusive.
// Handles timezone safety: toDate is treated as end-of-day in local time.
function inDateRange(day, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  if (!day) return false;
  return (!fromDate || day >= fromDate) && (!toDate || day <= toDate);
}

// Read-only summary of the Banking settlement collection, never wallet/ledger payments.
// Receipt date alone is not proof of its sales period. Existing unallocated receipts
// remain unallocated; we do not infer a company or match by equal amounts/references.
export function dashboardBankSummary(state, options, estimatedSettlement) {
  // Support both new options object API and legacy (month, estimatedSettlement) API for backward compatibility
  let month, fromDate, toDate;
  if (typeof options === 'string') {
    month = options;
  } else {
    ({ month, fromDate, toDate } = options);
  }
  const useDateRange = fromDate || toDate;
  const companies = new Set((state.companies || []).map(c => c.id));
  const seen = new Map();
  for (const receipt of state.bankSettlements || []) {
    if (!receipt.id) continue;
    const prior = seen.get(receipt.id);
    if (!prior || Number(receipt.version || 0) > Number(prior.version || 0)
      || (Number(receipt.version || 0) === Number(prior.version || 0) && String(receipt.updatedAt || '') >= String(prior.updatedAt || ''))) seen.set(receipt.id, receipt);
  }
  let receivedCents = 0, allocatedCents = 0, unallocatedCents = 0, invalid = false;
  const byScope = new Map();
  for (const receipt of seen.values()) {
    if (receipt.deletedAt || !market(receipt.marketplace)) continue;
    const kind = String(receipt.kind || receipt.type || '').toLowerCase().replace(/[ -]/g, '_');
    if (kind && !['settlement', 'marketplace_settlement', 'settlement_receipt', 'marketplace_settlement_receipt'].includes(kind)) continue;
    if (/wallet|agent|unrelated/i.test(String(receipt.source || ''))) continue;
    if (!cents(receipt.amountCents)) { invalid = true; continue; }
    const receiptDate = String(receipt.date || '').slice(0, 10);
    if (useDateRange ? inDateRange(receiptDate, fromDate, toDate) : String(receipt.date || '').slice(0, 7) === month) {
      receivedCents += receipt.amountCents;
    }
    // Optional explicit links can be read if present. This change adds no allocation
    // writer or Banking schema. Current records have no such links and stay provisional.
    const links = Array.isArray(receipt.allocations) ? receipt.allocations : [];
    const valid = links.every(a => cents(a.amountCents) && companies.has(a.companyId)
      && market(a.marketplace) === market(receipt.marketplace) && validMonth(a.salesMonth));
    const linkedTotal = links.reduce((sum, a) => sum + (cents(a.amountCents) ? a.amountCents : 0), 0);
    if (!valid || !Number.isSafeInteger(linkedTotal) || linkedTotal > receipt.amountCents) { unallocatedCents += receipt.amountCents; continue; }
    unallocatedCents += receipt.amountCents - linkedTotal;
    for (const link of links.filter(a => useDateRange ? inDateRange(a.salesMonth + "-01", fromDate, toDate) : a.salesMonth === month)) {
      allocatedCents += link.amountCents;
      const key = `${link.companyId}|${market(link.marketplace)}`;
      byScope.set(key, (byScope.get(key) || 0) + link.amountCents);
    }
  }
  const safe = [receivedCents, allocatedCents, unallocatedCents].every(Number.isSafeInteger);
  const estimatedCents = estimatedSettlement.amount === null ? null : Math.round(estimatedSettlement.amount * 100);
  const balanceCents = estimatedCents === null ? null : estimatedCents - allocatedCents;
  return { received: safe && !invalid ? receivedCents / 100 : null,
    allocated: safe ? allocatedCents / 100 : null,
    balance: safe && !invalid && balanceCents !== null && Number.isSafeInteger(balanceCents) ? balanceCents / 100 : null,
    provisional: invalid || !safe || unallocatedCents > 0 || estimatedSettlement.inferredQuantity > 0 || estimatedSettlement.missingQuantity > 0,
    allocationNote: unallocatedCents > 0 ? 'Receipt dates do not establish sales-period allocation.' : 'Based on explicit company, marketplace and sales-month allocations.',
    scopes: [...byScope].map(([key, value]) => { const [companyId, marketplace] = key.split('|'); return { companyId, marketplace, allocated: value / 100 }; }) };
}
