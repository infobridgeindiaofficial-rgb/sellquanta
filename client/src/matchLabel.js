// Match one scanned label row to a Product Master row for the selected Company + Marketplace.
// Priority:
//   1) Marketplace SKU: exact match, then the exact Product Master SKU found as a whole word inside the scanned SKU text
//      (labels often read "SEV14002 | description" or "SKU: SEV14002"), then inside the scanned product-name text, then anywhere in the
//      PDF page text (_pageText, only set when the page holds a single label).
//      A SKU match is never overridden or blocked by the scanned product name.
//   2) Only if no SKU matched (blank or unknown): exact Product Name match after lower-casing, removing punctuation
//      and collapsing spaces.
// The warehouse product always comes from Product Master, and masterName is the Product Master product name.
// SKU: trim + uppercase. Marketplace: trim + lowercase. Company is compared by companyId only.
// SKU lookup key (labelScan.skuKey): case-insensitive, ignores whitespace/line breaks, invisible Unicode characters and
// wrapping punctuation from PDF text. Only used for comparison - saved SKUs are never rewritten.
import { skuKey, cleanText } from "./labelScan.js";
const normSku = v => skuKey(v);
const normMp = v => String(v ?? "").trim().toLowerCase();
const normName = v => String(v ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole-word test: the SKU must not be glued to other letters, digits, "-" or "_" (so "SEV1400" never matches "SEV14002").
const hasSkuWord = (text, sku) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(sku)}($|[^A-Za-z0-9_-])`, "i").test(cleanText(text));

const productOfIn = products => m => products.find(p => p.id === m.productId) || null;

// Step 1 of the priority: Marketplace SKU (exact, then whole word in scanned text). Works on any list of Product Master rows.
// Returns { status: "Matched", m } | { status: "Needs Review" } | null when no SKU matched.
export function matchBySku(row, scope, products) {
  const usable = scope.filter(m => productOfIn(products)(m));
  const sku = normSku(row.sku);
  if (sku) {
    const exact = usable.filter(x => normSku(x.marketplaceSku) === sku);
    // Two different Product Master SKUs that only differ in spacing/case would be ambiguous - never guess.
    if (new Set(exact.map(x => cleanText(x.marketplaceSku).trim())).size > 1) return { status: "Needs Review", reason: "several Product Master SKUs match this SKU when spacing/case is ignored" };
    if (exact.length) return { status: "Matched", m: exact[0], via: "sku" };
  }
  for (const text of [row.sku, row.productName, row._pageText]) {
    if (!String(text ?? "").trim()) continue;
    const hits = usable.filter(x => normSku(x.marketplaceSku) && hasSkuWord(text, cleanText(x.marketplaceSku).trim()));
    const distinct = new Set(hits.map(x => normSku(x.marketplaceSku)));
    if (distinct.size > 1) return { status: "Needs Review", reason: "the label text contains several Product Master SKUs" };
    if (distinct.size === 1) return { status: "Matched", m: hits[0], via: "sku-in-text" };
  }
  return null;
}

// Step 2: exact normalised Product Name (only used when no SKU matched).
export function matchByName(row, scope, products) {
  const name = normName(row.productName);
  if (!name) return null;
  const hits = scope.filter(x => normName(x.productName) === name);
  if (hits.length > 1) return { status: "Needs Review" };
  if (hits.length === 1 && productOfIn(products)(hits[0])) return { status: "Matched", m: hits[0], via: "exact-name" };
  return null;
}

export function matchScanRow(row, { agent, account, productMaster, products }) {
  const none = { product: null, sku: String(row.sku || "").trim(), masterName: "", status: "Not Found" };
  if (!agent?.companyId || !account) return none;

  const scope = productMaster.filter(m => m.companyId === agent.companyId
    && normMp(m.marketplace) === normMp(account.marketplace));
  const r = matchBySku(row, scope, products) || matchByName(row, scope, products);
  if (!r) return none;
  if (r.status !== "Matched") return { ...none, status: r.status };
  return { product: productOfIn(products)(r.m), sku: r.m.marketplaceSku, masterName: r.m.productName, status: "Matched" };
}
