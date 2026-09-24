// Text-layer helpers for PDF shipping labels. Pure functions (no DOM) so they can be tested outside the browser.
//
// Flipkart label + invoice pages carry these stable text labels (learned from real Flipkart label PDFs):
//   "OD" + digits ............ Order Id (also printed after the "Order Id:" label)
//   "SKU ID | Description" ... header of the label table; the row under it is  "<n> <SKU> | <description> <QTY>"
//   "TOTAL PRICE: 294.00" .... the invoice total for the shipment, used as the Selling Amount
//   "TOTAL QTY: 1" ........... total quantity (cross-check)
// Nothing here is tied to one order or product.

// Group pdf.js text items into lines (top to bottom, left to right).
export function itemsToLines(items) {
  const cells = items
    .filter(it => String(it.str || "").trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5], s: String(it.str) }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const c of cells) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - c.y) <= 2.5) last.cells.push(c);
    else lines.push({ y: c.y, cells: [c] });
  }
  return lines.map(l => l.cells.sort((a, b) => a.x - b.x).map(c => c.s).join(" ").replace(/\s+/g, " ").trim());
}

const money = s => Number(String(s).replace(/,/g, ""));

// Returns [{ orderId, sku, productName, qty, saleAmount, source, layout }] for a single-item Flipkart page,
// or null when the page is not a Flipkart text page (or has several items/orders) so the caller can fall back to Ollama.
export function parseFlipkartLines(lines) {
  const header = lines.findIndex(l => /SKU ID\s*\|\s*Description/i.test(l));
  if (header < 0 || !/\bQTY\b/i.test(lines[header])) return null;
  const text = lines.join("\n");

  const orderIds = [...new Set(text.match(/\bOD\d{10,}\b/g) || [])];
  if (orderIds.length !== 1) return null;

  const items = [];
  for (const l of lines.slice(header + 1)) {
    if (/Not for resale|Printed at|Tax Invoice|Order Id/i.test(l)) break;
    const m = l.match(/^(\d{1,2})\s+(.+?)\s*\|\s*(.*)$/);
    if (m) items.push({ sku: m[2].trim(), rest: m[3].trim() });
  }
  if (items.length !== 1) return null;

  const withQty = items[0].rest.match(/^(.*?)\s+(\d{1,4})$/);
  const totalQty = text.match(/TOTAL QTY:\s*(\d+)/i)?.[1];
  const qty = Number(withQty ? withQty[2] : totalQty || 1) || 1;
  const total = text.match(/TOTAL PRICE:\s*([\d,]+(?:\.\d+)?)/i)?.[1];

  return [{
    orderId: orderIds[0],
    sku: items[0].sku,
    productName: (withQty ? withQty[1] : items[0].rest).trim(),
    qty,
    saleAmount: total ? money(total) : 0,
    source: "pdf-text",
    layout: "flipkart"
  }];
}
