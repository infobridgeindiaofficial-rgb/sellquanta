import XLSX from "xlsx";

function nameOf(arr, id) {
  return arr.find(x => x.id === id)?.name || "";
}

export function buildDayWorkbook(db, sales) {
  const agentMap = Object.fromEntries(db.agents.map(x => [x.id, x.name]));
  const accountMap = Object.fromEntries(db.accounts.map(x => [x.id, x.name]));
  const productMap = Object.fromEntries(db.products.map(x => [x.id, x.name]));

  const salesRows = sales.map(s => ({
    Date: s.date,
    Agent: agentMap[s.agentId] || "",
    Account: accountMap[s.accountId] || "",
    Marketplace: s.marketplace || "",
    "Order ID": s.orderId || "",
    SKU: s.sku || "",
    Product: productMap[s.productId] || s.productName || "",
    Quantity: s.qty,
    "Sale Amount": s.saleAmount,
    Source: s.source || "",
    "Tracking ID": s.trackingId || ""
  }));

  const usage = {};
  for (const s of sales) {
    const key = `${s.agentId}__${s.productId}`;
    usage[key] ||= { Agent: agentMap[s.agentId] || "", Product: productMap[s.productId] || s.productName || "", Quantity: 0 };
    usage[key].Quantity += Number(s.qty || 0);
  }

  const agentSummary = {};
  for (const s of sales) {
    agentSummary[s.agentId] ||= { Agent: agentMap[s.agentId] || "", Orders: 0, Quantity: 0, Sales: 0 };
    agentSummary[s.agentId].Orders += 1;
    agentSummary[s.agentId].Quantity += Number(s.qty || 0);
    agentSummary[s.agentId].Sales += Number(s.saleAmount || 0);
  }

  const stockRows = db.products.filter(p => p.active !== false).map(p => ({
    SKU: p.sku,
    Product: p.name,
    "Current Stock": p.stock,
    "Low Stock Level": p.lowStockLevel ?? 5
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), "Daily Sales");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(agentSummary)), "Agent Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(usage)), "Product Usage");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), "Warehouse Stock");
  return wb;
}
