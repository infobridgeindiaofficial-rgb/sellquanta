// Automatic detection for a scanned shipping label row: Marketplace -> Company -> Agent -> Account -> Warehouse product.
// No agent/company/marketplace is chosen by hand and none is hardcoded: everything is derived from the label and from
// Product Master, Companies, Agents (agent.companyId) and Accounts.
import { matchBySku, matchByName } from "./matchLabel.js";
import { skuKey } from "./labelScan.js";

export const MARKETPLACES = ["Amazon", "Flipkart", "Meesho"];
const norm = v => String(v ?? "").trim().toLowerCase();

// Marketplace clues from the label itself (several independent signals; never just one).
// Learned from real label PDFs:
//   Amazon  : order number NNN-NNNNNNN-NNNNNNN, text "Amazon Seller Services"
//   Flipkart: order id OD + digits, "SKU ID | Description", "E-Kart"
//   Meesho  : "Valmo" logistics mark, product table header "SKU Size Qty Color Order No."
export function detectMarketplaceClues(row) {
  const text = `${row._docText || ""} ${row._pageText || ""}`;
  const orderId = String(row.orderId ?? "").trim();
  const found = new Map(); // marketplace -> why
  const add = (mp, why) => { if (!found.has(mp)) found.set(mp, why); };

  if (row.layout === "flipkart") add("Flipkart", "Flipkart label layout");
  if (/^OD\d{10,}$/i.test(orderId)) add("Flipkart", "order id starts with OD");
  if (/\bOD\d{10,}\b/.test(text) && /SKU ID\s*\|\s*Description|e-?kart|flipkart/i.test(text)) add("Flipkart", "Flipkart text");
  if (/flipkart/i.test(text)) add("Flipkart", "Flipkart branding");

  if (/^\d{3}-\d{7}-\d{7}$/.test(orderId)) add("Amazon", "Amazon order number format");
  if (/\b\d{3}-\d{7}-\d{7}\b/.test(text) && /amazon/i.test(text)) add("Amazon", "Amazon text");
  if (/amazon/i.test(text)) add("Amazon", "Amazon branding");

  if (/meesho|valmo/i.test(text)) add("Meesho", "Meesho/Valmo branding");
  if (/SKU\s+Size\s+Qty\s+Color\s+Order No/i.test(text)) add("Meesho", "Meesho product table");

  const said = MARKETPLACES.find(m => norm(m) === norm(row.marketplace)); // what Ollama read from the image
  if (said) add(said, "read from the label image");

  return [...found.entries()].map(([marketplace, why]) => ({ marketplace, why }));
}

// Search Product Master across ALL companies for one marketplace.
// Priority: exact Marketplace SKU first; only if no company has a SKU match, exact normalised Product Name.
function matchAcrossCompanies(row, marketplace, productMaster, products) {
  const inMarketplace = productMaster.filter(m => norm(m.marketplace) === norm(marketplace));
  const companyIds = [...new Set(inMarketplace.map(m => m.companyId))];
  // Product Master is authoritative: a SKU read from the label is only ever matched by SKU. Exact product-name
  // matching is used only when the label had no SKU at all, and then only as Needs Review (never saved silently).
  const steps = skuKey(row.sku) ? [matchBySku] : [matchBySku, matchByName];
  for (const step of steps) {
    const results = companyIds.map(companyId => ({ companyId, r: step(row, inMarketplace.filter(m => m.companyId === companyId), products) })).filter(x => x.r);
    if (!results.length) continue;
    const matched = results.filter(x => x.r.status === "Matched");
    if (matched.length === 1 && results.length === 1) {
      if (matched[0].r.via === "exact-name") return { status: "Needs Review", reason: "matched only by product name (no SKU on the label) - add the sale manually if correct", companyId: matched[0].companyId, m: matched[0].r.m };
      return { status: "Matched", companyId: matched[0].companyId, m: matched[0].r.m, via: matched[0].r.via };
    }
    return { status: "Needs Review", reason: matched.length > 1 || results.length > 1 ? "same SKU/name under several companies" : (results[0]?.r?.reason || "ambiguous Product Master match") };
  }
  return { status: "Not Found" };
}

// Exact, human-readable reason a row is Not Found (Product Master stays the source of truth - nothing is created).
function notFoundReason(row, marketplace, productMaster, products, ctx = {}) {
  const key = skuKey(row.sku);
  const mp = marketplace || "any marketplace";
  if (!key) return "no Marketplace SKU found on the label";
  const shown = String(row.sku).trim();
  const allPm = ctx.allProductMaster || productMaster;
  const sameKey = allPm.filter(m => skuKey(m.marketplaceSku) === key);
  const inMp = sameKey.filter(m => !marketplace || norm(m.marketplace) === norm(marketplace));
  if (inMp.length) {
    const m = inMp[0];
    const active = productMaster.includes(m);
    if (!active) return `SKU ${shown} is mapped for ${m.marketplace} under an archived company`;
    const p = (ctx.allProducts || products).find(x => x.id === m.productId);
    if (!products.some(x => x.id === m.productId)) return p ? `SKU ${shown} is mapped to warehouse product ${p.sku}, which is archived` : `SKU ${shown} is mapped to a warehouse product that no longer exists`;
  }
  if (marketplace && sameKey.length) return `SKU ${shown} has no ${marketplace} mapping in Product Master (it is mapped for ${[...new Set(sameKey.map(m => m.marketplace))].join(", ")} only)`;
  const mpCount = marketplace ? productMaster.filter(m => norm(m.marketplace) === norm(marketplace)).length : productMaster.length;
  return `SKU ${shown} is not in Product Master for ${mp}${marketplace && mpCount === 0 ? ` (Product Master has no ${marketplace} mappings at all)` : ""}`;
}

export function resolveScanRow(row, { companies, agents, accounts, productMaster, products }, perf) {
  const clues = perf ? perf.sync('resolution_marketplace_detection',()=>detectMarketplaceClues(row),{rowId:row._id}) : detectMarketplaceClues(row);
  const clueMarketplaces = clues.map(c => c.marketplace);
  const detect = { clues, orderId: row.orderId, sku: row.sku };
  const fail = (status, reason, extra = {}) => ({ status, reason, marketplace: "", company: null, agent: null, account: null, product: null, sku: String(row.sku ?? "").trim(), masterName: "", detect, ...extra });

  // Which marketplaces to search: the one the label points to; if the label is silent or contradicts itself, let Product Master decide.
  const candidates = clueMarketplaces.length === 1 ? clueMarketplaces : clueMarketplaces.length > 1 ? clueMarketplaces : MARKETPLACES;
  const results = candidates.map(marketplace => ({ marketplace, ...matchAcrossCompanies(row, marketplace, productMaster, products) }));
  const matched = results.filter(x => x.status === "Matched");
  const review = results.filter(x => x.status === "Needs Review");

  let pick;
  if (clueMarketplaces.length === 1) pick = results[0];
  else if (matched.length === 1 && review.length === 0) pick = matched[0];
  else if (matched.length + review.length > 0) return fail("Needs Review", "could not tell the marketplace apart", { detect: { ...detect, candidates: results } });
  else pick = { status: "Not Found", marketplace: "" };

  const marketplace = pick.marketplace;
  detect.marketplaceFrom = clueMarketplaces.length === 1 ? "label" : "Product Master";
  detect.lookupKey = skuKey(row.sku);
  detect.lookupAttempted = true;
  if (pick.status !== "Matched") {
    const reason = pick.reason || (pick.status === "Not Found" ? notFoundReason(row, clueMarketplaces.length === 1 ? clueMarketplaces[0] : "", productMaster, products, arguments[1]) : "");
    return fail(pick.status, reason, { marketplace: marketplace || (clueMarketplaces.length === 1 ? clueMarketplaces[0] : ""), detect });
  }
  detect.matchedVia = pick.via || "";

  const product = products.find(p => p.id === pick.m.productId) || null;
  const company = companies.find(c => c.id === pick.companyId) || null;
  const base = { marketplace, company, product, sku: pick.m.marketplaceSku, masterName: pick.m.productName, detect };

  const candidatesAgents = agents.filter(a => a.companyId === pick.companyId && a.active !== false);
  if (candidatesAgents.length !== 1) {
    return { ...base, status: "Needs Review", reason: candidatesAgents.length ? "several active agents in this company" : "no active agent in this company", agent: null, account: null };
  }
  const agent = candidatesAgents[0];
  const account = accounts.find(a => a.agentId === agent.id && norm(a.marketplace) === norm(marketplace)) || null;
  if (!account) return { ...base, status: "Needs Review", reason: `agent has no ${marketplace} account`, agent, account: null };

  return { ...base, status: "Matched", reason: "", agent, account };
}

// One compact, developer-facing diagnostic record per scanned row (no raw label text): what was read, how, whether
// Ollama was used, the exact Product Master lookup key and the final status/reason. Logged to the console and to
// <data folder>/logs/scan-diagnostics.jsonl by the Daily Sales screen.
export function scanDiagnostic(row, d, { status, reason } = {}) {
  const diag = row._diag || {};
  return {
    at: new Date().toISOString(),
    file: row._sourceFile?.name || "",
    page: diag.page ?? null,
    method: row._scanMethod || "",
    stages: diag.stages || [],
    marketplace: d.marketplace || "",
    marketplaceSignals: (d.detect?.clues || []).map(c => `${c.marketplace}: ${c.why}`),
    orderId: row.orderId || "",
    sku: row.sku || "",
    skuKey: skuKey(row.sku),
    qty: row.qty, amount: row.saleAmount,
    unverified: [row._qtyUncertain && "qty", row._amountUncertain && "amount", row._reviewNote && "order"].filter(Boolean),
    ollama: diag.ollama || { called: false },
    verifyNotes: diag.verifyNotes || [],
    parserNotes: diag.notes || [],
    productMasterLookup: { attempted: !!d.detect?.lookupAttempted, key: d.detect?.lookupKey || "", matched: !!d.product, via: d.detect?.matchedVia || "" },
    company: d.company?.name || "", agent: d.agent?.name || "", account: d.account?.name || "",
    warehouseProduct: d.product ? `${d.product.sku} ${d.product.name}` : "",
    status: status || d.status, reason: reason ?? d.reason ?? ""
  };
}
