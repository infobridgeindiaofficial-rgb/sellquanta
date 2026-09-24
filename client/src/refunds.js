// Refund eligibility (mirrors the rule the server enforces): a sale can be refunded once, through the 10th local calendar day
// after its sale date (sale on Sep 10 -> last refund day Sep 20). The original sale is never removed from Sales History.
export const REFUND_DAYS = 10;
const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const saleDate = s => {
  const t = Date.parse(s.createdAt || "");
  return Number.isFinite(t) ? new Date(t) : new Date(`${String(s.date || "").slice(0, 10)}T12:00:00`);
};
export const saleLocalDay = s => localDay(saleDate(s));
export const refundDeadlineDay = s => { const d = saleDate(s); return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + REFUND_DAYS)); };

// Sales (open + archived) that can still be refunded right now, newest first.
export function refundableSales(state, now = new Date()) {
  const refunded = new Set((state.refunds || []).map(r => r.saleId));
  const today = localDay(now);
  return [...(state.salesHistory || []), ...(state.todaySales || [])]
    .filter(s => !refunded.has(s.id) && today <= refundDeadlineDay(s))
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}
