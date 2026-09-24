// Accuracy-first label extraction (used by fastPdfParser.scanPdfPage).
//
// Stage 1 (existing, unchanged): parsePdfLines - strict single-item layouts only.
// Stage 2 (this file): tolerant structured parsing of the PDF text layer for the real Amazon invoice, Flipkart
//   label+invoice and Meesho label+invoice layouts: multi-line titles, CGST+SGST tax rows, several identical item rows
//   in one order, etc. Every value is read from the marketplace's own field/structure; nothing is guessed.
// Stage 3 (fallback): Ollama reads the page image; every AI value is then VERIFIED against the page text before use
//   (verifyAiRows). A value the text contradicts is replaced by the text value or rejected; a value that cannot be
//   confirmed is kept only as a flagged value that blocks saving until the user confirms it.
// Pure functions, no DOM/network - testable in Node.

import { detectMarketplace } from './labelDetectors.js';
import { guardFallbackQuantity } from './qtyGuard.js';

// ---- normalisation -----------------------------------------------------------------------------------------------
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;
// Text as the parser sees it: Unicode-normalised, invisible characters removed, odd spaces made plain.
export const cleanText = v => String(v ?? '').normalize('NFKC').replace(INVISIBLE, '').replace(/[  -   　]/g, ' ');
// Lookup key for a Marketplace SKU: never stored, only compared. Case-insensitive, no whitespace (PDF line breaks /
// spacing artefacts), no invisible characters, no wrapping punctuation ("(SKU)", "SKU |", "SKU:").
export const skuKey = v => cleanText(v).replace(/\s+/g, '').replace(/^[|:;,.()[\]{}"'`]+|[|:;,.()[\]{}"'`]+$/g, '').toUpperCase();
// Display value: the SKU as printed, just trimmed and cleaned.
export const skuDisplay = v => cleanText(v).replace(/\s+/g, ' ').trim();

const money = s => Number(String(s).replace(/[,\s]/g, ''));
const cents = n => Math.round(Number(n) * 100);
const uniq = a => [...new Set(a)];

export const ORDER_PATTERNS = {
  Amazon: /\b\d{3}-\d{7}-\d{7}\b/g,
  Flipkart: /\bOD\d{9,}\b/gi,
  Meesho: /\b\d{15,19}_\d{1,3}\b/g
};

// Marketplace from the page text. Returns { marketplace|null, signals: [..], scores }.
export function textSignals(lines) {
  const text = cleanText(lines.join('\n'));
  const signals = [];
  const add = (mp, why) => signals.push({ marketplace: mp, why });
  if (/\bamazon\b|amazon\.in/i.test(text)) add('Amazon', 'Amazon text');
  if (/Sl\.\s*Unit\s+Net\s+Tax/i.test(text) && /\b[A-Z0-9]{10}\s*\(\s*[^()\s]+\s*\)/.test(text)) add('Amazon', 'Amazon invoice item row (ASIN ( SKU ))');
  if (/e-?kart\s+logistics/i.test(text)) add('Flipkart', 'E-Kart Logistics');
  if (/SKU ID\s*\|\s*Description/i.test(text)) add('Flipkart', 'Flipkart "SKU ID | Description" table');
  if (/\bflipkart\b/i.test(text)) add('Flipkart', 'Flipkart text');
  if (/SKU\s+Size\s+Qty\s+Color\s+Order\s*No/i.test(text)) add('Meesho', 'Meesho "SKU Size Qty Color Order No." table');
  if (/Original\s+For\s+Recipient/i.test(text)) add('Meesho', 'Meesho tax invoice heading');
  if (/\bvalmo\b|\bmeesho\b/i.test(text)) add('Meesho', 'Meesho/Valmo text');
  for (const [mp, re] of Object.entries(ORDER_PATTERNS)) if ((text.match(re) || []).length) add(mp, `${mp} order-number format`);
  const detection = detectMarketplace(text);
  const found = uniq(signals.map(s => s.marketplace));
  // One marketplace with at least one structural signal, and the shared detector does not disagree.
  const marketplace = found.length === 1 && (!detection.marketplace || detection.marketplace === found[0]) ? found[0] : null;
  return { marketplace, signals, scores: detection.scores, conflicting: found.length > 1 };
}

// ---- Amazon invoice ----------------------------------------------------------------------------------------------
const AMAZON_ITEM = /\b([A-Z0-9]{10})\s*\(\s*([^()\s]+)\s*\)\s*₹\s?([\d,]+\.\d{2})\s+(\d{1,5})\s+₹\s?([\d,]+\.\d{2})((?:\s+\d+(?:\.\d+)?%\s+[A-Z]+\s+₹\s?[\d,]+\.\d{2})*)\s+₹\s?([\d,]+\.\d{2})/g;
function parseAmazon(lines) {
  const flat = cleanText(lines.join(' ')).replace(/\s+/g, ' ');
  const orderIds = uniq(flat.match(ORDER_PATTERNS.Amazon) || []);
  const items = [...flat.matchAll(AMAZON_ITEM)].map(m => ({ asin: m[1], sku: m[2], unit: money(m[3]), qty: Number(m[4]), net: money(m[5]), lineTotal: money(m[7]) }));
  const total = [...flat.matchAll(/\bTOTAL:\s*₹\s?([\d,]+\.\d{2})\s+₹\s?([\d,]+\.\d{2})/g)].map(m => money(m[2]));
  const result = { orderIds, items, totals: uniq(total) };
  if (orderIds.length !== 1 || !items.length) return { ...result, rows: [] };
  // Product title: from the Sl. No "1 ..." line up to the ASIN.
  const i1 = lines.findIndex(l => /^1\s+\S/.test(cleanText(l)) && lines.slice(0, lines.indexOf(l)).some(x => /Sl\.\s*Unit/i.test(x)));
  let title = '';
  if (i1 >= 0) {
    const tail = cleanText(lines.slice(i1, i1 + 4).join(' ')).replace(/^1\s+/, '');
    title = tail.split(/\|\s*[A-Z0-9]{10}\s*\(/)[0].replace(/\s*\|\s*$/, '').trim();
  }
  return { ...result, rows: groupItems(items, i => i.sku).map(g => ({ sku: g.sku, qty: g.qty, lineTotal: g.lineTotal, productName: g.count === 1 || items.length === g.count ? title : '' })) };
}
function groupItems(items, keyOf) {
  const groups = new Map();
  for (const it of items) {
    const k = skuKey(keyOf(it));
    const g = groups.get(k) || { sku: skuDisplay(keyOf(it)), qty: 0, lineTotal: 0, count: 0, hasLineTotal: true };
    g.qty += it.qty; g.count++;
    if (typeof it.lineTotal === 'number' && Number.isFinite(it.lineTotal)) g.lineTotal = Math.round((g.lineTotal + it.lineTotal) * 100) / 100; else g.hasLineTotal = false;
    groups.set(k, g);
  }
  return [...groups.values()];
}

// ---- Flipkart label + invoice -----------------------------------------------------------------------------------
function parseFlipkart(lines) {
  const clean = lines.map(cleanText);
  const text = clean.join('\n');
  const orderIds = uniq((text.match(ORDER_PATTERNS.Flipkart) || []).map(s => s.toUpperCase()));
  const header = clean.findIndex(l => /SKU ID\s*\|\s*Description/i.test(l));
  const items = [];
  let itemLines = 0;
  if (header >= 0) {
    for (const l of clean.slice(header + 1)) {
      if (/Not for resale|Printed at|Tax Invoice|Order Id/i.test(l)) break;
      if (/^\d{1,2}\s+\S.*\|/.test(l)) itemLines++;
      const m = l.match(/^(\d{1,2})\s+(.+?)\s*\|\s*(.*?)\s+(\d{1,4})\s*$/);
      if (m) items.push({ sku: m[2], productName: m[3], qty: Number(m[4]) });
    }
  }
  const totalQty = uniq([...text.matchAll(/TOTAL\s+QTY\s*:?\s*(\d+)/gi)].map(m => Number(m[1])));
  const totalPrice = uniq([...text.matchAll(/TOTAL\s+PRICE\s*:?\s*([\d,]+(?:\.\d+)?)/gi)].map(m => money(m[1])));
  const groups = groupItems(items.map(i => ({ ...i, lineTotal: undefined })), i => i.sku);
  const rows = groups.map(g => ({ sku: g.sku, qty: g.qty, productName: items.find(i => skuKey(i.sku) === skuKey(g.sku))?.productName || '' }));
  return { orderIds, items, itemLines, totalQty, totalPrice, rows };
}

// ---- Meesho label + invoice -------------------------------------------------------------------------------------
const MEESHO_ROW = /^(\S+)\s+(.+?)\s+(\d{1,5})\s+([^\d]+?)\s+(\d{15,19}_\d{1,3})\s*$/;
function parseMeesho(lines) {
  const clean = lines.map(cleanText);
  const text = clean.join('\n');
  const rows = clean.map(l => l.match(MEESHO_ROW)).filter(Boolean).map(m => ({ sku: m[1], qty: Number(m[3]), orderId: m[5] }));
  const invoice = /TAX INVOICE/i.test(text) && /Original\s+For\s+Recipient/i.test(text);
  const totals = invoice ? uniq([...text.matchAll(/^Total\s+Rs\.\s*[\d,]+\.\d{2}\s+Rs\.\s*([\d,]+\.\d{2})\s*$/gim)].map(m => money(m[1]))) : [];
  // Product description: the lines between the invoice table header and the HSN row, minus tax fragments.
  let productName = '';
  const h = clean.findIndex(l => /^Description\s+HSN\s+Qty/i.test(l));
  if (h >= 0) {
    const parts = [];
    for (const l of clean.slice(h + 1, h + 8)) {
      if (/^Other Charges|^Total\b/i.test(l)) break;
      const t = l.replace(/IGST\s*@\s*[\d.]+%|CGST\s*@\s*[\d.]+%|SGST\s*@\s*[\d.]+%/gi, '').replace(/\b\d{6,8}\s+\d+\s+Rs\..*$/, '').replace(/Rs\.[\d,]+\.\d{2}/g, '').trim();
      if (t) parts.push(t);
    }
    productName = parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return { rows, totals, invoice, productName };
}

// ---- Stage 2 entry point ----------------------------------------------------------------------------------------
// Returns { marketplace, signals, method, complete, rows: [ { marketplace, orderId, sku, productName, qty, saleAmount,
//   _verified: {orderId, sku, qty, amount}, _holds: {field: reason} } ] }.
// `complete` = every row has all fields verified from the text; then no Ollama call is needed.
export function extractStructured(lines) {
  const sig = textSignals(lines);
  const out = { marketplace: sig.marketplace, signals: sig.signals, conflicting: sig.conflicting, method: 'PDF_TEXT_STRUCTURED', rows: [], complete: false, notes: [] };
  if (!lines.some(l => String(l).trim()) || !sig.marketplace) return out;
  const mp = sig.marketplace;
  const mk = (r, verified, holds = {}) => ({ marketplace: mp, productName: '', ...r, source: 'pdf-text', layout: mp.toLowerCase(), _verified: verified, _holds: holds });

  if (mp === 'Amazon') {
    const a = parseAmazon(lines);
    if (a.orderIds.length !== 1) { out.notes.push(`Amazon order numbers found: ${a.orderIds.length}`); return out; }
    if (!a.rows.length) { out.notes.push('no Amazon "ASIN ( SKU )" item row found'); return out; }
    const grand = a.totals.length === 1 ? a.totals[0] : null;
    if (a.rows.length > 1) {
      out.notes.push('several different products in one Amazon order');
      out.rows = a.rows.map(r => mk({ orderId: a.orderIds[0], sku: r.sku, productName: r.productName, qty: r.qty, saleAmount: r.lineTotal },
        { orderId: true, sku: true, qty: true, amount: false }, { order: 'this order has several different products - check each row', amount: 'amount per product not confirmed' }));
      return out;
    }
    const r = a.rows[0];
    const amountOk = grand !== null && cents(grand) === cents(r.lineTotal);
    out.rows = [mk({ orderId: a.orderIds[0], sku: r.sku, productName: r.productName, qty: r.qty, saleAmount: grand ?? r.lineTotal },
      { orderId: true, sku: true, qty: true, amount: amountOk }, amountOk ? {} : { amount: 'invoice TOTAL does not match the item total - check Amount' })];
    out.complete = amountOk;
    return out;
  }

  if (mp === 'Flipkart') {
    const f = parseFlipkart(lines);
    if (f.orderIds.length !== 1) { out.notes.push(`Flipkart order ids found: ${f.orderIds.length}`); return out; }
    if (!f.rows.length) { out.notes.push('no Flipkart "SKU | Description QTY" row found'); return out; }
    const sumQty = f.items.reduce((t, i) => t + i.qty, 0);
    const qtyOk = f.itemLines === f.items.length && (f.totalQty.length === 0 || (f.totalQty.length === 1 && f.totalQty[0] === sumQty));
    const amount = f.totalPrice.length === 1 ? f.totalPrice[0] : null;
    if (f.rows.length > 1) {
      out.notes.push('several different products in one Flipkart order');
      out.rows = f.rows.map(r => mk({ orderId: f.orderIds[0], sku: r.sku, productName: r.productName, qty: r.qty, saleAmount: 0 },
        { orderId: true, sku: true, qty: qtyOk, amount: false }, { order: 'this order has several different products - check each row', amount: 'amount per product not printed separately - enter Amount' }));
      return out;
    }
    const r = f.rows[0];
    const holds = {};
    if (!qtyOk) holds.qty = 'item quantities do not add up to TOTAL QTY - check Qty';
    if (amount === null) holds.amount = 'TOTAL PRICE not found on the label - enter Amount';
    out.rows = [mk({ orderId: f.orderIds[0], sku: r.sku, productName: r.productName, qty: qtyOk ? r.qty : (f.totalQty[0] || r.qty), saleAmount: amount ?? 0 },
      { orderId: true, sku: true, qty: qtyOk, amount: amount !== null }, holds)];
    out.complete = qtyOk && amount !== null;
    return out;
  }

  if (mp === 'Meesho') {
    const m = parseMeesho(lines);
    if (!m.rows.length) { out.notes.push('no Meesho "SKU Size Qty Color Order No." row found'); return out; }
    const single = m.rows.length === 1;
    const amount = single && m.totals.length === 1 ? m.totals[0] : null;
    out.rows = m.rows.map(r => mk({ orderId: r.orderId, sku: r.sku, productName: single ? m.productName : '', qty: r.qty, saleAmount: amount ?? 0 },
      { orderId: true, sku: true, qty: true, amount: amount !== null }, amount !== null ? {} : { amount: single ? 'invoice total not found on the label' : 'several labels on one page - amount per label not confirmed' }));
    out.complete = out.rows.every(r => r._verified.amount);
    return out;
  }
  return out;
}

// ---- Stage 3: verify AI rows against the page text ----------------------------------------------------------------
const ASIN_SKU = /\b[A-Z0-9]{10}\s*\(\s*([^()\s]+)\s*\)/;
function textHas(text, value) {
  const v = skuKey(value);
  return !!v && skuKey(text).includes(v);
}
// Merge Ollama rows with structured partial rows. Text-verified values always win; AI values the text cannot confirm
// are either rejected (order id / SKU / marketplace) or flagged for the user (qty / amount).
export function verifyAiRows(aiRows, lines, structured) {
  const hasText = lines.some(l => String(l).trim());
  const text = cleanText(lines.join('\n'));
  const pageMp = structured?.marketplace || null;
  const notes = [];
  const base = (structured?.rows || []);
  const merged = [];
  const rows = aiRows.length ? aiRows : base.map(() => ({}));
  rows.forEach((ai, i) => {
    const holds = {};
    const det = base.length === rows.length ? base[i] : (base.length === 1 && rows.length === 1 ? base[0] : null);
    const r = { ...ai };
    // Marketplace: page text is authoritative; the AI's guess is only used for image labels without text.
    if (pageMp) { if (r.marketplace && r.marketplace !== pageMp) notes.push(`AI marketplace "${r.marketplace}" replaced by page text "${pageMp}"`); r.marketplace = pageMp; }
    // Order id: must be printed on the page.
    if (det?.orderId) r.orderId = det.orderId;
    else if (hasText && r.orderId && !textHas(text, r.orderId)) { notes.push(`AI order id "${r.orderId}" is not on the page - rejected`); r.orderId = ''; }
    // SKU: structured value first; otherwise the AI value only if it is printed on the page; Amazon "ASIN ( SKU )"
    // inside the AI's product text is recovered.
    const aiSku = skuDisplay(r.sku);
    if (det?.sku) r.sku = det.sku;
    else if (aiSku && (!hasText || textHas(text, aiSku))) r.sku = aiSku;
    else {
      if (aiSku) notes.push(`AI SKU "${aiSku}" is not on the page - rejected`);
      const fromName = cleanText(r.productName).match(ASIN_SKU)?.[1];
      r.sku = fromName && (!hasText || textHas(text, fromName)) ? fromName : '';
      if (fromName && r.sku) notes.push(`SKU "${fromName}" recovered from "ASIN ( SKU )" in the AI product text`);
    }
    if (!r.sku) holds.sku = 'no Marketplace SKU could be read from the label';
    if (det?.productName) r.productName = det.productName;
    // Quantity: structured value, else qtyGuard rules (label Qty field / title-number check).
    if (det && det._verified?.qty) r.qty = det.qty;
    else {
      const g = guardFallbackQuantity(r, lines, rows.length);
      r.qty = g.qty;
      if (g._qtyUncertain) holds.qty = g._qtyNote; else if (g._qtyNote) notes.push(g._qtyNote);
    }
    // Amount: structured verified value; else the AI value only if that exact amount is printed on the page.
    const aiAmount = Number(r.saleAmount);
    if (det && det._verified?.amount) r.saleAmount = det.saleAmount;
    else if (hasText) {
      const printed = Number.isFinite(aiAmount) && aiAmount > 0 && amountPrinted(text, aiAmount);
      if (printed) { r.saleAmount = aiAmount; holds.amount = `amount ₹${aiAmount} read by AI - confirm it is the order total`; }
      else { r.saleAmount = Number.isFinite(aiAmount) && aiAmount > 0 ? aiAmount : 0; holds.amount = aiAmount > 0 ? `AI amount ₹${aiAmount} is not printed on the label - check Amount` : 'amount not found on the label - enter Amount'; }
    } else if (!(aiAmount > 0)) { r.saleAmount = 0; holds.amount = 'amount could not be read - enter Amount'; }
    else r.saleAmount = aiAmount;
    for (const [k, v] of Object.entries(det?._holds || {})) if (!(k in holds)) holds[k] = v;
    merged.push({ ...r, _holds: holds, _verifyNotes: notes.slice() });
  });
  return merged;
}

function amountPrinted(text, amount) {
  const target = cents(amount);
  for (const m of text.matchAll(/(?:₹|Rs\.?|INR)?\s?(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)) if (cents(money(m[1])) === target && /[.,]|₹|Rs|INR/.test(m[0])) return true;
  return false;
}
