// The agent wallet formula. Mirrors walletTotals() in server/index.mjs exactly, so the number shown here always matches
// what the server enforces for payments and Reset Wallet:
//   Only ledger entries after the agent's latest Wallet Reset count (a reset stores the ids of the entries it closes
//   off - nothing is deleted; all earlier history stays in the ledger, Month Close archives and reports).
//   Stock Cost Due   = SUM of those SALE entries (a sale adds its stock cost; a refund reversal subtracts the full
//                       sale amount - see server /api/refunds)
//   Wallet Credit     = SUM of PAYMENT entries + SUM of legacy SETTLEMENT entries (older resets wrote those)
//   Current Balance   = max(0, Stock Cost Due - Wallet Credit) - never shown negative: a credit in the agent's
//                       favour is not something SellQuanta pays out.
export function latestWalletReset(walletResets, agentId) {
  const own = (walletResets || []).filter(r => r.agentId === agentId);
  return own.length ? own[own.length - 1] : null;
}
export function currentWalletEntries(ledger, agentId, walletResets) {
  const before = new Set(latestWalletReset(walletResets, agentId)?.excludedLedgerIds || []);
  return (ledger || []).filter(l => l.agentId === agentId && !before.has(l.id));
}
export function agentWalletTotals(ledger, agentId, walletResets) {
  const entries = currentWalletEntries(ledger, agentId, walletResets);
  const cents = type => Math.round(entries.filter(l => l.type === type).reduce((t, l) => t + Number(l.amount || 0), 0) * 100);
  const due = cents("SALE") / 100;
  const paid = (cents("PAYMENT") + cents("SETTLEMENT")) / 100;
  return { due, paid, pending: Math.max(0, Math.round((due - paid) * 100) / 100) };
}

// How a ledger row's Type should read on screen (used by both the global Ledger table and the Agent Details one).
export const ledgerTypeLabel = l => l.kind === "REFUND_REVERSAL" ? "SALE REFUND" : l.type === "SETTLEMENT" ? "WALLET RESET" : l.type;

// Local date + time, e.g. "24-09-2026 09:15 AM" (the computer's own time zone).
export function localDateTime(iso, fallbackDate = "") {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) {
    const m = String(fallbackDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : (fallbackDate || "—");
  }
  const p = n => String(n).padStart(2, "0");
  const h = d.getHours(), h12 = h % 12 || 12;
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(h12)}:${p(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

// Permanent Payment / Settlement History for one agent: every payment (live ledger AND payments moved into Month
// Close archives), legacy settlement entries, and every Wallet Reset. Newest first. Read-only; nothing is filtered away
// by later payments or resets.
export function paymentHistory(state, agentId) {
  const seen = new Set();
  const out = [];
  const addLedger = (l, archived) => {
    if (l.agentId !== agentId || seen.has(l.id)) return;
    if (l.type !== "PAYMENT" && l.type !== "SETTLEMENT") return;
    seen.add(l.id);
    out.push({ id: l.id, at: l.createdAt || "", date: l.date || "", type: l.type === "PAYMENT" ? "Payment Sent" : "Wallet Settlement (old reset)", amount: Number(l.amount || 0), note: l.note || "", archived });
  };
  for (const l of state.ledger || []) addLedger(l, false);
  for (const a of state.monthCloseArchive || []) for (const l of a.ledger || []) addLedger(l, true);
  for (const r of state.walletResets || []) if (r.agentId === agentId) out.push({ id: r.id, at: r.resetAt, date: r.date, type: "Wallet Reset", amount: null, note: r.note || "Wallet reset", balanceBefore: r.balanceBefore });
  const key = e => e.at || `${e.date}T00:00:00`;
  return out.sort((a, b) => key(b).localeCompare(key(a)));
}
