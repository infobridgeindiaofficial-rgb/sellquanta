// Scan quantity safety.
// A scanned row's quantity must come from the marketplace's own Qty field/structure - never from numbers inside the
// product title ("Pack of 2", "Set of 6", "400 ml", sizes, model or SKU numbers). The fast PDF parser already reads
// quantity only from those structures. This guard covers rows read by Ollama (the AI fallback), which can confuse a
// title number with the quantity:
//   - if the page's text has the marketplace's quantity field for this row, that value is used;
//   - if the page has text but no confirmable quantity field, the row is flagged "quantity uncertain";
//   - image labels (no text): the AI's value is kept unless it is missing/invalid or equals a number in the title's
//     pack/size/measure text, in which case the row is flagged.
// A flagged row shows as Needs Review and is never saved (stock is never deducted) until the user confirms the Qty.

const norm = v => String(v ?? "").trim().toLowerCase();
const one = values => { const s = [...new Set(values)]; return s.length === 1 ? s[0] : s.length ? NaN : null; };
const positiveInt = n => Number.isSafeInteger(n) && n > 0;

// Amazon invoice item row: "<ASIN> ( <seller SKU> ) ₹<unit price> <QTY> ₹<net amount> ..."
const AMAZON_ITEM = /\b[A-Z0-9]{10}\s+\(\s*([^\s()]+)\s*\)\s+₹[\d,]+\.\d{2}\s+(\d{1,5})\s+₹[\d,]+\.\d{2}/g;
// Meesho label table row: "<SKU> <size> <QTY> <color> <sub-order no>" (color never contains digits)
const MEESHO_ROW = /^(\S+)\s+(.+?)\s+(\d{1,5})\s+([^\d]+?)\s+(\d{15,19}_\d{1,3})\s*$/;

// Quantity for `row` from the marketplace quantity field(s) in the page text.
// Returns a positive integer, null (no field found) or NaN (fields disagree).
export function structuredQuantity(row, lines = [], rowsOnPage = 1) {
  const text = lines.join("\n");
  const sku = norm(row.sku);
  const found = [];

  // Amazon invoice rows (matched to this row by seller SKU; the only row on the page may be used without a SKU).
  const amazon = [...text.matchAll(AMAZON_ITEM)].map(m => ({ sku: norm(m[1]), qty: Number(m[2]) }));
  if (amazon.length) {
    const mine = amazon.filter(a => sku && a.sku === sku);
    if (mine.length) found.push(...mine.map(a => a.qty));
    else if (amazon.length === 1 && rowsOnPage === 1) found.push(amazon[0].qty);
  }

  // Meesho label table (matched by sub-order number, else the only table row on a single-row page).
  const meesho = lines.map(l => l.match(MEESHO_ROW)).filter(Boolean);
  if (meesho.length) {
    const oid = norm(row.orderId);
    const mine = meesho.filter(m => oid && norm(m[5]) === oid);
    if (mine.length) found.push(...mine.map(m => Number(m[3])));
    else if (meesho.length === 1 && rowsOnPage === 1) found.push(Number(meesho[0][3]));
  }

  // Explicit single-value fields ("Qty: 3", "Quantity 3", Flipkart "TOTAL QTY: 3") - only when the page holds one row.
  if (rowsOnPage === 1) {
    for (const m of text.matchAll(/^(?:total\s+)?(?:qty|quantity)\s*:?\s*(\d{1,5})\s*$/gim)) found.push(Number(m[1]));
  }
  // A Flipkart item row's trailing number is only trusted when TOTAL QTY is also present (it then must agree),
  // because a wrapped title can end with a number ("... Set of 6").
  if (rowsOnPage === 1 && /^total\s+qty\s*:?\s*\d+\s*$/im.test(text)) {
    const header = lines.findIndex(l => /SKU ID\s*\|\s*Description/i.test(l));
    const item = header >= 0 ? lines.slice(header + 1).find(l => /^\d{1,2}\s+.+?\s*\|/.test(l)) : null;
    const q = item?.match(/\|.*\s+(\d{1,4})\s*$/)?.[1];
    if (q) found.push(Number(q));
  }

  const q = one(found);
  if (q === null) return null;
  return positiveInt(q) ? q : NaN;
}

// Numbers that appear in product-title pack/size/measure phrases: "Pack of 2", "Set of 6", "400 ml", "2 x 500 g", "12 pcs".
export function titleNumbers(title) {
  const t = String(title || "");
  const nums = new Set();
  const add = re => { for (const m of t.matchAll(re)) for (const g of m.slice(1)) if (g) nums.add(Number(g)); };
  add(/\b(?:pack|set|combo|box|pk|bundle|case)\s*(?:of|-)?\s*(\d+)/gi);
  add(/\b(\d+)\s*[-]?\s*(?:pack|pcs?|pieces?|units?|nos?|pairs?|sets?|in\s*1)\b/gi);
  add(/\b(\d+(?:\.\d+)?)\s*(?:ml|l|ltr|litres?|liters?|g|gm|gms|grams?|kg|cm|mm|m|inch(?:es)?|in|ft|oz|w|v)\b/gi);
  add(/\b(\d+)\s*[x×*]\s*(\d+)/gi);
  return nums;
}

// Decide the quantity for a row read by Ollama. Returns the row with qty set and, when needed, _qtyUncertain + _qtyNote.
export function guardFallbackQuantity(row, lines = [], rowsOnPage = 1) {
  const aiQty = Number(row.qty);
  const hasText = lines.some(l => String(l).trim());
  if (hasText) {
    const q = structuredQuantity(row, lines, rowsOnPage);
    if (positiveInt(q)) {
      return q === aiQty ? { ...row, qty: q } : { ...row, qty: q, _qtyNote: `Qty taken from the label's Qty field (AI read ${Number.isFinite(aiQty) ? aiQty : "nothing"})` };
    }
    return { ...row, qty: positiveInt(aiQty) ? aiQty : 1, _qtyUncertain: true,
      _qtyNote: Number.isNaN(q) ? "Qty fields on the label disagree - check Qty" : "Qty could not be confirmed from the label's Qty field - check Qty" };
  }
  if (!positiveInt(aiQty)) return { ...row, qty: 1, _qtyUncertain: true, _qtyNote: "Qty could not be read from the label - check Qty" };
  if (aiQty > 1 && titleNumbers(row.productName).has(aiQty)) {
    return { ...row, qty: aiQty, _qtyUncertain: true, _qtyNote: `Qty ${aiQty} matches a number in the product title - check Qty` };
  }
  return { ...row, qty: aiQty };
}
