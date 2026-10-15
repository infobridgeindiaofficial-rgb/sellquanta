import { saleDay, localToday } from './dashboardStats.js';
export { localToday };

export function salesForDate(state, date) {
  return salesForRange(state,date,date);
}

export function salesForRange(state, fromDate, toDate) {
  if(!fromDate||!toDate||fromDate>toDate)return [];
  const unique = new Map();
  for (const [index,sale] of [...(state.salesHistory || []), ...(state.todaySales || [])].entries()) unique.set(sale.id || `legacy:${index}`, sale);
  return [...unique.values()].reverse().filter(sale => saleDay(sale) >= fromDate && saleDay(sale) <= toDate)
    .sort((a,b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
}

// Mirrors the backend's global latest-batch selection, never a filtered list's latest row.
export function undoEligibility(state, selectedDate) {
  const all = [...(state.salesHistory || []), ...(state.todaySales || [])].filter(s => s.batchId);
  if (!all.length) return { enabled: false, reason: 'No saved sales batch to undo.' };
  const last = all.reduce((a,b) => String(b.createdAt || '') >= String(a.createdAt || '') ? b : a);
  const batch = (state.todaySales || []).filter(s => s.batchId === last.batchId);
  if (!batch.length || (state.salesHistory || []).some(s => s.batchId === last.batchId)) return { enabled: false, reason: 'The latest batch is archived and cannot be undone.' };
  if (batch.some(s => saleDay(s) !== selectedDate)) return { enabled: false, reason: 'The latest batch is not entirely on the selected date. Select its date to undo it.' };
  if (batch.some(s => (state.refunds || []).some(r => r.saleId === s.id))) return { enabled: false, reason: 'The latest batch contains a refunded sale and cannot be undone.' };
  if (batch.some(s => !(state.products || []).some(p => p.id === s.productId))) return { enabled: false, reason: 'The warehouse product for this batch no longer exists.' };
  return { enabled: true, batchId: last.batchId, reason: 'Undo the latest saved batch on the selected date.' };
}
