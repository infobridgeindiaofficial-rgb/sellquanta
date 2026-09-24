import { spawn } from "node:child_process";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5vl:3b";

let startAttempted = false;

async function ping() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return r.ok;
  } catch {
    return false;
  }
}

export async function ensureOllama() {
  if (await ping()) return { ok: true, started: false };

  if (!startAttempted) {
    startAttempted = true;
    try {
      const child = spawn("ollama", ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      // If Ollama is not installed the spawn fails with an "error" event; without this listener that event would crash the backend.
      child.on("error", () => {});
      child.unref();
    } catch {}
  }

  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 600));
    if (await ping()) return { ok: true, started: true };
  }
  return { ok: false, started: false };
}

function cleanJson(text) {
  const trimmed = String(text || "").trim();
  const noFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(noFence); } catch {}

  const a = noFence.indexOf("[");
  const b = noFence.lastIndexOf("]");
  if (a >= 0 && b > a) {
    try { return JSON.parse(noFence.slice(a, b + 1)); } catch {}
  }
  const o = noFence.indexOf("{");
  const p = noFence.lastIndexOf("}");
  if (o >= 0 && p > o) {
    try { return JSON.parse(noFence.slice(o, p + 1)); } catch {}
  }
  throw new Error("Ollama response was not valid JSON.");
}

export const OLLAMA_SETTINGS = { url: OLLAMA_URL, model: OLLAMA_MODEL };
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 180000);

// The configured model must already be installed locally. It is never downloaded automatically.
async function modelInstalled() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const names = ((await r.json()).models || []).map(m => m.name);
    return names.some(n => n === OLLAMA_MODEL || n === `${OLLAMA_MODEL}:latest` || n.replace(/:latest$/, "") === OLLAMA_MODEL);
  } catch { return false; }
}

export async function scanLabel(base64Image, marketplace) {
  const status = await ensureOllama();
  if (!status.ok) {
    throw new Error("Ollama is not running or not installed. Label scanning needs Ollama on this computer: install it from ollama.com (or open it if it is already installed), then try Scan again. Everything else in SellQuanta works without it.");
  }
  if (!(await modelInstalled())) {
    throw new Error(`The Ollama model "${OLLAMA_MODEL}" is not installed on this computer. Install it once with: ollama pull ${OLLAMA_MODEL}`);
  }

  const prompt = `
You are reading an ecommerce SHIPPING LABEL image. It may contain ONE label or multiple labels on one A4 sheet (including 4-in-1).
Marketplace context: ${marketplace || "not given - work it out from the label"}.

Return ONLY valid JSON. No markdown. No explanation.

Return an array. One object per visible shipment/order:
[
  {
    "orderId": "",
    "sku": "",
    "productName": "",
    "qty": 1,
    "saleAmount": 0,
    "marketplace": ""
  }
]

"marketplace" is the marketplace the label belongs to, judged only from what is visible (branding, logistics marks or the order number format): "Amazon", "Flipkart" or "Meesho". Use "" if you cannot tell.

Only these fields are needed. Ignore tracking numbers, customer names and addresses.

SKU rules (the "sku" field is the seller's marketplace SKU and is very important):
- Actively look for text labelled SKU, Seller SKU, Merchant SKU, MSKU, Seller item code or SKU ID, and copy the value exactly as printed.
- For Flipkart and Meesho also look for Supplier SKU, Catalog SKU and Product SKU.
- Return the exact visible SKU text next to that label. Do not shorten, reformat or translate it.
- Do NOT put an ASIN (for example B0XXXXXXXX) in "sku" unless the document explicitly labels that value as SKU.
- If no SKU is printed for a shipment, use "" for sku.

Rules:
- Read only what is visible.
- If a field is missing, use "" or 0.
- qty must be a number and at least 1.
- AMAZON invoices: the item row reads "<ASIN> ( <seller SKU> )", e.g. "B0ABCDE123 ( ABC-12345 )". The value INSIDE the parentheses is the "sku" (here ABC-12345). saleAmount is the final "Total Amount" / "TOTAL:" invoice value.
- FLIPKART labels: several item rows with the SAME SKU in one order (OD...) are ONE shipment - return one object with qty = TOTAL QTY and saleAmount = TOTAL PRICE.
- MEESHO labels (Valmo, "SKU Size Qty Color Order No.", order number ending in _1, "Original For Recipient"): marketplace is "Meesho"; saleAmount is the LAST amount on the invoice "Total" row (not the gross amount).
- qty is ONLY the value printed in the label/invoice Qty or Quantity column/field for that shipment. Never take qty from numbers in the product title or description such as "Pack of 2", "Set of 6", "400 ml", sizes, weights, dimensions, model or SKU numbers. If no Qty field is visible, use 0.
- saleAmount must be numeric.
- If there are 4 labels, return 4 objects.
- Do not invent SKU, order ID, product name or amount.
`;

  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    format: "json",
    messages: [
      {
        role: "user",
        content: prompt,
        images: [base64Image]
      }
    ],
    options: { temperature: 0 }
  };

  // One retry when the model answers with something that is not valid JSON. Accuracy over speed.
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let r;
    try {
      r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
      });
    } catch (e) {
      throw new Error(e.name === "TimeoutError" ? `Ollama did not answer within ${Math.round(OLLAMA_TIMEOUT_MS / 1000)} seconds.` : `Ollama request failed: ${e.message}`);
    }
    if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = await r.json();
    try {
      const parsed = cleanJson(data?.message?.content);
      const list = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.orders) ? parsed.orders
        : Array.isArray(parsed?.shipments) ? parsed.shipments
        : Array.isArray(parsed?.rows) ? parsed.rows
        : Array.isArray(parsed?.labels) ? parsed.labels
        : [parsed];
      return list.filter(x => x && typeof x === "object");
    } catch (e) { lastError = e; }
  }
  throw lastError;
}
