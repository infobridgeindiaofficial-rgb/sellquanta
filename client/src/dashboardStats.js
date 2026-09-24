// Dashboard figures, computed from the real records: Sales History (archived by Close Day) + today's open sales + Refunds.
// A sale lives in exactly one of the two sales lists, so nothing is counted twice. Pure functions, no DOM.
//
// Refunds: the original sale is never changed. A refund is its own record and counts in the month of the REFUND date
// (a Sept 28 sale refunded on Oct 3 leaves September's gross sale alone and shows as an October refund).
//   Net Sales = Gross Sales - Refunds        Net Quantity = Sold Quantity - Refunded Quantity
//
// Three different things are kept apart on purpose:
//   1) PERIOD Sales Due  - stock cost of the period's sales, less what the period's refunds took off the agent (the full sale amount).
//   2) PERIOD Payments   - not shown on the Dashboard.
//   3) CUMULATIVE wallet - the permanent ledger balance, shown only on Agents & Wallet.
export const MARKETPLACES = ["Amazon", "Flipkart", "Meesho"];

const pad = n => String(n).padStart(2, "0");
const canonicalMarketplace = v => MARKETPLACES.find(m => m.toLowerCase() === String(v ?? "").trim().toLowerCase()) || String(v ?? "").trim();

// Calendar day of a sale in the user's local time (from its saved timestamp), falling back to the stored date.
export function saleDay(s) {
  const t = Date.parse(s.createdAt || "");
  if (Number.isFinite(t)) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  return String(s.date || "").slice(0, 10);
}
export const saleMonth = s => saleDay(s).slice(0, 7);
export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// A refund belongs to the local day/month of the refund transaction itself.
export const refundDay = r => saleDay({ createdAt: r.refundedAt, date: r.refundDate });
export const refundMonth = r => refundDay(r).slice(0, 7);

export const monthLabel = ym => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

export const allSales = state => [...(state.salesHistory || []), ...(state.todaySales || [])];

// Months that have sales or refunds, plus the current month, newest first.
export function monthOptions(state, now = new Date()) {
  const set = new Set(allSales(state).map(saleMonth).filter(Boolean));
  (state.refunds || []).forEach(r => set.add(refundMonth(r)));
  set.add(localToday(now).slice(0, 7));
  return [...set].filter(Boolean).sort().reverse();
}

// Gross sold figures for a list of sales, less the refunds in `refunds` (already limited to the same slice).
const tally = (list, refunds = []) => {
  const orders = new Set();
  let grossQty = 0, grossSales = 0;
  for (const s of list) {
    orders.add(String(s.orderId || "").trim().toLowerCase() || `sale:${s.id}`); // a sale with no Order ID counts as its own order
    grossQty += Number(s.qty || 0);
    grossSales += Number(s.saleAmount || 0);
  }
  const refundQty = refunds.reduce((t, r) => t + Number(r.qty || 0), 0);
  const refundAmount = refunds.reduce((t, r) => t + Number(r.refundAmount || 0), 0);
  return { orders: orders.size, qty: grossQty - refundQty, sales: grossSales - refundAmount, grossQty, grossSales, refundQty, refundAmount, refundCount: refunds.length };
};

// Cost-basis helpers shared by every per-agent/per-period stock-cost figure in this file: costOf() is the actual
// warehouse cost charged for one sale (the ledger SALE entry linked to it, else the saved cost snapshot); refundDue()
// is what a refund takes back off the agent's Sales Due (the FULL sale amount, not just the cost - see server
// /api/refunds). refundCost() is only used for the Dashboard's own inventory profit figure, which nets a refund by
// its cost instead.
export function costBasis(state) {
  const ledgerCost = new Map(state.ledger.filter(l => l.type === "SALE" && l.referenceId).map(l => [l.referenceId, Number(l.amount || 0)]));
  const costOf = s => ledgerCost.has(s.id) ? ledgerCost.get(s.id) : (typeof s.costTotal === "number" ? s.costTotal : 0);
  const refundCost = list => list.reduce((t, r) => t + Number(r.costAmount || 0), 0);
  const refundDue = list => list.reduce((t, r) => t + Number(r.dueReversalAmount ?? r.costAmount ?? 0), 0);
  return { costOf, refundCost, refundDue };
}

export function dashboardStats(state, month, now = new Date()) {
  const refunds = state.refunds || [];
  const inMonth = allSales(state).filter(s => saleMonth(s) === month);
  const refundsInMonth = refunds.filter(r => refundMonth(r) === month);
  const agentById = new Map(state.agents.map(a => [a.id, a]));
  const productById = new Map(state.products.map(p => [p.id, p]));
  const companyName = new Map(state.companies.map(c => [c.id, c.name]));
  const companyOf = s => s.companyId || agentById.get(s.agentId)?.companyId || "";
  const marketOf = s => canonicalMarketplace(s.marketplace);

  const { costOf, refundCost, refundDue } = costBasis(state);

  const totals = tally(inMonth, refundsInMonth);
  const allCosted = inMonth.length > 0 && inMonth.every(s => typeof s.costTotal === "number");
  const stockCost = inMonth.reduce((t, s) => t + (typeof s.costTotal === "number" ? s.costTotal : 0), 0) - refundCost(refundsInMonth);

  const companies = state.companies.map(c => {
    const own = inMonth.filter(s => companyOf(s) === c.id);
    const ownRefunds = refundsInMonth.filter(r => (r.companyId || agentById.get(r.agentId)?.companyId || "") === c.id);
    return {
      id: c.id, name: c.name, ...tally(own, ownRefunds),
      marketplaces: MARKETPLACES.map(m => ({ marketplace: m, ...tally(own.filter(s => marketOf(s) === m), ownRefunds.filter(r => canonicalMarketplace(r.marketplace) === m)) }))
    };
  });

  // Company + Marketplace reporting groups, ranked by net sales (not a fixed account count).
  const accounts = companies.flatMap(c => c.marketplaces.map(m => ({ company: c.name, marketplace: m.marketplace, orders: m.orders, qty: m.qty, sales: m.sales })))
    .sort((a, b) => b.sales - a.sales || b.orders - a.orders || a.company.localeCompare(b.company));

  // Products, kept separate per company + marketplace so you can see where each one sold. Quantities and sales are net of refunds.
  const groups = new Map();
  const groupFor = (productId, companyId, marketplace, fallback) => {
    const key = `${productId}|${companyId}|${marketplace}`;
    if (!groups.has(key)) groups.set(key, {
      productName: productById.get(productId)?.name || fallback.productName || "—",
      code: productById.get(productId)?.sku || fallback.code || "—",
      company: companyName.get(companyId) || fallback.company || "—",
      marketplace: marketplace || "—", qty: 0, sales: 0
    });
    return groups.get(key);
  };
  for (const s of inMonth) {
    const g = groupFor(s.productId, companyOf(s), marketOf(s), { productName: s.productName, code: s.warehouseProductCode || s.sku, company: s.companyName });
    g.qty += Number(s.qty || 0); g.sales += Number(s.saleAmount || 0);
  }
  for (const r of refundsInMonth) {
    const g = groupFor(r.productId, r.companyId || agentById.get(r.agentId)?.companyId || "", canonicalMarketplace(r.marketplace), { productName: r.productName, code: r.warehouseProductCode, company: r.companyName });
    g.qty -= Number(r.qty || 0); g.sales -= Number(r.refundAmount || 0);
  }
  const topProducts = [...groups.values()].sort((a, b) => b.qty - a.qty || b.sales - a.sales);

  const agentIdsWithActivity = new Set([...inMonth.map(s => s.agentId), ...refundsInMonth.map(r => r.agentId)]);
  const agents = state.agents.filter(a => a.active !== false || agentIdsWithActivity.has(a.id)).map(a => {
    const own = inMonth.filter(s => s.agentId === a.id);
    const ownRefunds = refundsInMonth.filter(r => r.agentId === a.id);
    return { id: a.id, name: a.name, company: companyName.get(a.companyId) || "—", ...tally(own, ownRefunds), salesDue: own.reduce((t, s) => t + costOf(s), 0) - refundDue(ownRefunds) };
  });

  const today = localToday(now);
  const todayTotals = tally(allSales(state).filter(s => saleDay(s) === today), refunds.filter(r => refundDay(r) === today));

  return {
    totals, companies, accounts, topProducts, agents, today: todayTotals,
    profit: { available: false, stockCost: allCosted ? stockCost : null, salesMinusStockCost: allCosted ? totals.sales - stockCost : null },
    lowStock: state.products.filter(p => p.active !== false && p.stock <= (p.lowStockLevel ?? 5))
  };
}

// ALL-TIME (not month-limited) breakdown for ONE agent, used by the Agent Wallet Details panel on Agents & Wallet to
// answer "why does this agent owe this amount?". Grouped by product + marketplace, using the exact same cost/refund
// math as the cumulative ledger balance (costOf, refundDue - see costBasis above and server walletTotals), so:
//   SUM of every row's Total Stock Cost === this agent's ledger Stock Cost Due, to the rupee
// A row's Qty Sold / Unit Cost / Sale Amount only count sales that have NOT been refunded (so they read as plain,
// intuitive numbers); its Total Stock Cost additionally nets out that row's OWN refunds the same way the ledger does
// (the sale's cost, minus the refund's FULL sale amount) - so a heavily-refunded row can show a small negative stock
// cost. That is the existing refund rule, not a new one: see the file-level comment about PERIOD Sales Due above.
// `reset` (optional): the agent's latest Wallet Reset record. When given, only the CURRENT wallet period is counted -
// sales/refunds whose ledger entry was created after that reset (entries without one: by timestamp) - so every figure
// here adds up to the same Stock Cost Due as the wallet (client/src/wallet.js). Earlier records are not deleted.
export function agentWalletBreakdown(state, agentId, reset = null) {
  const { costOf, refundDue } = costBasis(state);
  const excluded = new Set(reset?.excludedLedgerIds || []);
  const saleLedger = new Map((state.ledger || []).filter(l => l.type === "SALE" && l.referenceId).map(l => [l.referenceId, l]));
  const refundLedger = new Map((state.ledger || []).filter(l => l.kind === "REFUND_REVERSAL" && l.refundId).map(l => [l.refundId, l]));
  const afterReset = (entry, at) => !reset || (entry ? !excluded.has(entry.id) : String(at || "") > String(reset.resetAt));
  const own = allSales(state).filter(s => s.agentId === agentId && afterReset(saleLedger.get(s.id), s.createdAt));
  const ownRefunds = (state.refunds || []).filter(r => r.agentId === agentId && afterReset(refundLedger.get(r.id), r.refundedAt));
  const refundedSaleIds = new Set(ownRefunds.map(r => r.saleId).filter(Boolean));
  const productById = new Map(state.products.map(p => [p.id, p]));

  const totals = tally(own, ownRefunds); // { orders, qty, sales, grossQty, grossSales, refundQty, refundAmount, refundCount }
  const stockCostDue = own.reduce((t, s) => t + costOf(s), 0) - refundDue(ownRefunds);

  const rows = new Map();
  const rowFor = (productId, marketplace, fallback) => {
    const mp = canonicalMarketplace(marketplace) || "—";
    const key = `${productId || fallback.code || "?"}|${mp}`;
    if (!rows.has(key)) rows.set(key, {
      productId,
      productName: productById.get(productId)?.name || fallback.productName || "—",
      code: productById.get(productId)?.sku || fallback.code || "—",
      marketplace: mp,
      qty: 0, unrefundedCost: 0, stockCost: 0, sales: 0
    });
    return rows.get(key);
  };
  for (const s of own) {
    const g = rowFor(s.productId, s.marketplace, { productName: s.productName, code: s.warehouseProductCode || s.sku });
    const cost = costOf(s);
    g.stockCost += cost; // every sale's cost counts here first; a matching refund below nets its OWN row back out
    if (!refundedSaleIds.has(s.id)) { g.qty += Number(s.qty || 0); g.unrefundedCost += cost; g.sales += Number(s.saleAmount || 0); }
  }
  for (const r of ownRefunds) {
    const g = rowFor(r.productId, r.marketplace, { productName: r.productName, code: r.warehouseProductCode });
    g.stockCost -= Number(r.dueReversalAmount ?? r.costAmount ?? 0);
  }

  const byProduct = [...rows.values()]
    .map(g => ({
      productId: g.productId, productName: g.productName, code: g.code, marketplace: g.marketplace,
      qty: g.qty, sales: Math.round(g.sales * 100) / 100, stockCost: Math.round(g.stockCost * 100) / 100,
      unitCost: g.qty > 0 ? Math.round((g.unrefundedCost / g.qty) * 100) / 100 : 0
    }))
    .sort((a, b) => b.stockCost - a.stockCost || a.productName.localeCompare(b.productName));

  // Marketplace rows are just byProduct re-grouped, so they reconcile with the agent total the same way byProduct does.
  const byMarketplace = MARKETPLACES
    .map(m => {
      const inMarket = byProduct.filter(g => g.marketplace === m);
      return {
        marketplace: m,
        qty: inMarket.reduce((t, g) => t + g.qty, 0),
        sales: Math.round(inMarket.reduce((t, g) => t + g.sales, 0) * 100) / 100,
        stockCost: Math.round(inMarket.reduce((t, g) => t + g.stockCost, 0) * 100) / 100
      };
    })
    .filter(m => m.qty || m.sales || m.stockCost);

  return { totals, stockCostDue: Math.round(stockCostDue * 100) / 100, byProduct, byMarketplace, refundCount: ownRefunds.length };
}
