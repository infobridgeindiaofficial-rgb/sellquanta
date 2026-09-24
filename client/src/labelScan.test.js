// Accuracy-first scanner regressions. Fixtures are real label PDF text layers (customer names/addresses removed) and
// the REAL answers the local Ollama model (qwen2.5vl:3b) gave for the same labels during diagnosis (2026-09-24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractStructured, verifyAiRows, skuKey, textSignals } from './labelScan.js';
import { scanPdfPage } from './fastPdfParser.js';
import { resolveScanRow } from './autoDetect.js';

const fixtures = Object.fromEntries(JSON.parse(readFileSync(new URL('./test-fixtures/labelScanLines.json', import.meta.url), 'utf8')).map(f => [f.name, f]));
const noOllama = () => assert.fail('Ollama must not be called when the text proves every field');
const noRender = () => assert.fail('page must not be rendered');
// Recorded real Ollama output (see report): SKU left blank (it sat in the product text), Flipkart 3x order read as
// qty 1 / ₹237, Meesho label called "Flipkart" with the gross amount.
const REAL_OLLAMA = {
  amazon: [{ orderId: '406-0000000-0000002', sku: '', productName: 'Glass Storage Jar with Copper Lid, 400 ml, Pack of 2 | B0TESTAA02 ( JAR21402 )', qty: 30, saleAmount: 11940, marketplace: 'Amazon' }],
  flipkart: [{ orderId: 'OD300000000000000002', sku: 'TIN140011', productName: 'demobrand Silver Tea Coffee & Sugar Container - 600 ml premium', qty: 1, saleAmount: 237, marketplace: 'Flipkart' }],
  meesho: [{ orderId: '330000000000000010_1', sku: 'tst01-SkuA00000001', productName: 'Stainless Steel Idiyappam Maker / Sev Maker with 6 Interchangeable Plates & Hand Crank - Free Size', qty: 1, saleAmount: 320.11, marketplace: 'Flipkart' }]
};

test('marketplace layouts: every field is read from the PDF text, no Ollama (Amazon CGST+SGST/multi-line title, Flipkart 3 identical items, Meesho, singles)', async () => {
  for (const f of Object.values(fixtures)) {
    const s = extractStructured(f.lines);
    assert.equal(s.complete, true, f.name);
    const r = s.rows[0];
    assert.deepEqual({ marketplace: r.marketplace, orderId: r.orderId, sku: r.sku, qty: r.qty, saleAmount: r.saleAmount }, f.expected, f.name);
    const rows = await scanPdfPage({ lines: f.lines, render: noRender }, {}, noOllama);
    assert.equal(rows.length, 1, f.name);
    assert.deepEqual({ sku: rows[0].sku, qty: rows[0].qty, saleAmount: rows[0].saleAmount }, { sku: f.expected.sku, qty: f.expected.qty, saleAmount: f.expected.saleAmount }, f.name);
    assert.ok(['FAST_PDF_PARSER', 'PDF_TEXT_STRUCTURED'].includes(rows[0]._scanMethod), f.name);
    assert.equal(rows[0]._diag.ollama.called, false);
  }
  // The two layouts that used to go to Ollama now stay deterministic.
  const amazon = await scanPdfPage({ lines: fixtures['amazon-cgst-multiline-title'].lines, render: noRender }, {}, noOllama);
  assert.equal(amazon[0]._scanMethod, 'PDF_TEXT_STRUCTURED');
  assert.match(amazon[0].productName, /Glass Storage Jar with Copper Lid, 400 ml, Pack of 2/);
});

test('real Ollama answers are verified against the page text: text wins, unconfirmable values are flagged', () => {
  const amazonLines = fixtures['amazon-cgst-multiline-title'].lines;
  const a = verifyAiRows(REAL_OLLAMA.amazon, amazonLines, { marketplace: 'Amazon', rows: [] })[0];
  assert.equal(a.sku, 'JAR21402', 'SKU recovered from "ASIN ( SKU )" in the AI product text');
  assert.equal(a.qty, 30); assert.equal(a._holds.qty, undefined);
  assert.equal(a.saleAmount, 11940); assert.match(a._holds.amount, /confirm/, 'AI amount printed on the page still needs confirmation');

  const fkLines = fixtures['flipkart-3-identical-items'].lines;
  const full = verifyAiRows(REAL_OLLAMA.flipkart, fkLines, extractStructured(fkLines))[0];
  assert.deepEqual([full.qty, full.saleAmount, full._holds], [3, 711, {}], 'structured TOTAL QTY / TOTAL PRICE replace the AI qty 1 / ₹237');
  const noStruct = verifyAiRows(REAL_OLLAMA.flipkart, fkLines, { marketplace: 'Flipkart', rows: [] })[0];
  assert.ok(noStruct._holds.qty, 'AI qty 1 conflicts with TOTAL QTY 3 -> flagged, never silently used');

  const meLines = fixtures['meesho-label-invoice'].lines;
  const m = verifyAiRows(REAL_OLLAMA.meesho, meLines, extractStructured(meLines))[0];
  assert.equal(m.marketplace, 'Meesho', 'AI marketplace "Flipkart" replaced by the page text');
  assert.equal(m.saleAmount, 322.11, 'invoice total, not the AI gross amount');

  // AI values that are not printed on the page are rejected.
  const bad = verifyAiRows([{ orderId: '999-9999999-9999999', sku: 'INVENTED-1', qty: 1, saleAmount: 5 }], amazonLines, { marketplace: 'Amazon', rows: [] })[0];
  assert.equal(bad.orderId, ''); assert.notEqual(bad.sku, 'INVENTED-1'); assert.ok(bad._holds.amount);
});

test('Ollama success path: incomplete text -> AI called once, fields verified, diagnostics recorded', async () => {
  const lines = ['amazon.in', 'Order ID: 406-0000000-0000002', 'Seller SKU: JAR21402', 'Qty: 30', 'Invoice Value: 11,940.00'];
  let calls = 0;
  const rows = await scanPdfPage({ lines, render: async () => 'image' }, {}, async () => { calls++; return { rows: REAL_OLLAMA.amazon, model: 'qwen2.5vl:3b' }; });
  assert.equal(calls, 1);
  assert.equal(rows[0]._scanMethod, 'OLLAMA_VERIFIED');
  assert.equal(rows[0].sku, 'JAR21402'); assert.equal(rows[0].qty, 30); assert.equal(rows[0].marketplace, 'Amazon');
  assert.deepEqual([rows[0]._diag.ollama.called, rows[0]._diag.ollama.ok, rows[0]._diag.ollama.model], [true, true, 'qwen2.5vl:3b']);
});

test('Ollama unavailable: text-proven fields are kept with the real error; no text at all -> the error is reported', async () => {
  const partial = fixtures['flipkart-single'].lines.filter(l => !/TOTAL PRICE/i.test(l));
  const s = extractStructured(partial);
  assert.equal(s.complete, false); assert.equal(s.rows.length, 1);
  const rows = await scanPdfPage({ lines: partial, render: async () => 'image' }, {}, async () => { throw new Error('Ollama is not running or not installed.'); });
  assert.equal(rows[0]._scanMethod, 'PDF_TEXT_PARTIAL');
  assert.equal(rows[0].sku, 'BTL14004');
  assert.ok(rows[0]._holds.amount, 'missing amount is flagged, not invented');
  assert.deepEqual([rows[0]._diag.ollama.ok, rows[0]._diag.ollama.error], [false, 'Ollama is not running or not installed.']);
  await assert.rejects(scanPdfPage({ lines: [], render: async () => 'image' }, {}, async () => { throw new Error('offline'); }), /offline/);
});

test('SKU lookup key ignores case, whitespace/line breaks, invisible characters and wrapping punctuation', () => {
  for (const v of ['btl14004', ' BTL14004 ', 'BTL​14004', 'BTL14004﻿', 'BTL\n14004', 'BTL 14004', '(BTL14004)', 'BTL14004 |', 'ＢＴＬ１４００４'])
    assert.equal(skuKey(v), 'BTL14004', JSON.stringify(v));
  assert.notEqual(skuKey('BTL14004'), skuKey('BTL1400'));
  assert.equal(textSignals(fixtures['meesho-label-invoice'].lines).marketplace, 'Meesho');
});

// Product Master resolution --------------------------------------------------------------------------------------
const ctxBase = () => ({
  companies: [{ id: 'c1', name: 'Demo Traders' }],
  agents: [{ id: 'a1', companyId: 'c1', name: 'Asha', active: true }],
  accounts: ['Amazon', 'Flipkart', 'Meesho'].map(m => ({ id: `ac-${m}`, agentId: 'a1', marketplace: m, name: `Asha - ${m}` })),
  products: [{ id: 'p1', sku: 'PRD-25', name: 'Water bottle' }, { id: 'p2', sku: 'PRD-06', name: 'Coconut peeler' }, { id: 'p3', sku: 'PRD-01', name: 'Sev maker' }, { id: 'p4', sku: 'PRD-40', name: 'Jar' }, { id: 'p5', sku: 'PRD-41', name: 'Tea container' }],
  productMaster: [
    { companyId: 'c1', marketplace: 'Flipkart', marketplaceSku: 'BTL14004', productId: 'p1', productName: 'Plastic water botel with glass' },
    { companyId: 'c1', marketplace: 'Flipkart', marketplaceSku: 'CUT0601', productId: 'p2', productName: 'coconut peeler' },
    { companyId: 'c1', marketplace: 'Flipkart', marketplaceSku: 'SEV14002', productId: 'p3', productName: 'sev maker with 6 jali' },
    { companyId: 'c1', marketplace: 'Flipkart', marketplaceSku: 'TIN140011', productId: 'p5', productName: 'silver container' },
    { companyId: 'c1', marketplace: 'Amazon', marketplaceSku: 'JAR21402', productId: 'p4', productName: 'copper tea coffe jar pack of 2' },
    { companyId: 'c1', marketplace: 'Meesho', marketplaceSku: 'tst01-SkuA00000001', productId: 'p3', productName: 'sev maker with 6 jali' }
  ]
});
const row = (marketplace, sku, extra = {}) => ({ marketplace, sku, orderId: 'X', productName: '', layout: marketplace.toLowerCase(), _docText: `${marketplace} ${sku}`, ...extra });

test('Product Master resolution: Flipkart rows resolve company, agent, account and warehouse product (with odd SKU text)', () => {
  const ctx = ctxBase();
  for (const [sku, code] of [['BTL14004', 'PRD-25'], ['cut0601 ', 'PRD-06'], ['SEV​14002', 'PRD-01']]) {
    const d = resolveScanRow(row('Flipkart', sku), ctx);
    assert.equal(d.status, 'Matched', sku);
    assert.deepEqual([d.company.name, d.agent.name, d.account.marketplace, d.product.sku], ['Demo Traders', 'Asha', 'Flipkart', code]);
    assert.equal(d.detect.lookupKey, skuKey(sku));
  }
});

test('Not Found only when the SKU is genuinely not mapped - with the exact reason, and no name guessing', () => {
  const ctx = ctxBase();
  let d = resolveScanRow(row('Flipkart', 'UNKNOWN-9'), ctx);
  assert.equal(d.status, 'Not Found'); assert.match(d.reason, /SKU UNKNOWN-9 is not in Product Master for Flipkart/);
  // Live-data situation found during diagnosis: Product Master has only Meesho mappings.
  const meeshoOnly = { ...ctx, productMaster: ctx.productMaster.filter(m => m.marketplace === 'Meesho') };
  d = resolveScanRow(row('Flipkart', 'BTL14004'), meeshoOnly);
  assert.match(d.reason, /Product Master has no Flipkart mappings at all/);
  // Mapped for another marketplace only.
  d = resolveScanRow(row('Flipkart', 'JAR21402'), ctx);
  assert.match(d.reason, /no Flipkart mapping .*mapped for Amazon only/);
  // Mapped to an archived warehouse product.
  d = resolveScanRow(row('Flipkart', 'BTL14004'), { ...ctx, products: ctx.products.filter(p => p.id !== 'p1'), allProducts: [...ctx.products.map(p => p.id === 'p1' ? { ...p, active: false } : p)] });
  assert.match(d.reason, /archived/);
  // A SKU that is on the label but not mapped is never rescued by an exact product-name match.
  d = resolveScanRow(row('Flipkart', 'OTHER-1', { productName: 'coconut peeler' }), ctx);
  assert.equal(d.status, 'Not Found');
  // No SKU at all + exact product name -> Needs Review (never saved silently).
  d = resolveScanRow(row('Flipkart', '', { productName: 'coconut peeler' }), ctx);
  assert.equal(d.status, 'Needs Review'); assert.match(d.reason, /product name/);
  d = resolveScanRow(row('Flipkart', ''), ctx);
  assert.match(d.reason, /no Marketplace SKU/);
});

test('mixed Amazon + Flipkart + Meesho batch: every real layout resolves to the right warehouse product', async () => {
  const ctx = ctxBase();
  const expect = { 'amazon-cgst-multiline-title': 'PRD-40', 'flipkart-3-identical-items': 'PRD-41', 'meesho-label-invoice': 'PRD-01', 'flipkart-single': 'PRD-25' };
  for (const [name, code] of Object.entries(expect)) {
    const [r] = await scanPdfPage({ lines: fixtures[name].lines, render: noRender }, ctx, noOllama);
    const d = resolveScanRow(r, ctx);
    assert.equal(d.status, 'Matched', name); assert.equal(d.product.sku, code, name); assert.equal(d.marketplace, fixtures[name].expected.marketplace);
  }
  const [amazonMesh] = await scanPdfPage({ lines: fixtures['amazon-igst-single'].lines, render: noRender }, ctx, noOllama);
  assert.equal(resolveScanRow(amazonMesh, ctx).status, 'Not Found', 'unmapped SKU stays Not Found');
});
