// Scan quantity safety regressions. Quantity must come from the marketplace Qty field/structure, never from
// numbers in the product title ("Pack of 2", "Set of 6", "400 ml", ...). Pure fixtures only - no live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdfLines, scanPdfPage } from './fastPdfParser.js';
import { guardFallbackQuantity, structuredQuantity, titleNumbers } from './qtyGuard.js';

// Amazon invoice modelled on the real layout (client/src/test-fixtures/realPdfLines.json) for the reported order:
// 406-0000000-0000002, title contains "400 ml, Pack of 2", actual invoice Qty 30, total ₹11,940.00.
const HEADER = ['Sl. Unit Net Tax Tax Tax Total', 'Description Qty', 'No Price Amount Rate Type Amount Amount'];
const amazonPack = ({ wrapTitle = true, asinPrefix = '' } = {}) => [
  'Tax Invoice/Bill of Supply/Cash Memo',
  'Order Number: 406-0000000-0000002 Invoice Number : IN-77',
  ...HEADER,
  ...(wrapTitle
    ? ['1 Stainless Steel Airtight Container for Kitchen Storage,', '400 ml, Pack of 2 |']
    : ['1 Stainless Steel Airtight Container for Kitchen Storage, 400 ml, Pack of 2 |']),
  `${asinPrefix}B0CXYZ1234 ( SSC400-P2 ) ₹337.29 30 ₹10,118.64 18% IGST ₹1,821.36 ₹11,940.00`,
  'HSN:73239390',
  'TOTAL: ₹1,821.36 ₹11,940.00',
  '*ASSPL-Amazon Seller Services Pvt. Ltd., ARIPL-Amazon Retail India Pvt. Ltd.'
];
const noOllama = () => assert.fail('Ollama must not be called');
const noRender = () => assert.fail('page must not be rendered');

test('Amazon "Pack of 2" title with invoice Qty 30 parses Qty 30 (wrapped and unwrapped titles)', async () => {
  for (const wrapTitle of [true, false]) {
    const lines = amazonPack({ wrapTitle });
    const parsed = parsePdfLines(lines);
    assert.ok(parsed, `fast parser must read this invoice (wrapTitle=${wrapTitle})`);
    assert.deepEqual({ orderId: parsed[0].orderId, sku: parsed[0].sku, qty: parsed[0].qty, saleAmount: parsed[0].saleAmount },
      { orderId: '406-0000000-0000002', sku: 'SSC400-P2', qty: 30, saleAmount: 11940 });
    const rows = await scanPdfPage({ lines, render: noRender }, {}, noOllama);
    assert.equal(rows[0].qty, 30);
    assert.equal(rows[0]._scanMethod, 'FAST_PDF_PARSER');
  }
});

test('title fragment before the ASIN: the structured text parser now reads Qty 30 without Ollama; an AI Qty 2 is replaced by the label Qty field', async () => {
  // Layout the strict parser rejects (title fragment on the ASIN line). Stage 2 (labelScan.js) reads it from the text.
  const lines = amazonPack({ asinPrefix: 'Pack of 2 | ' });
  assert.equal(parsePdfLines(lines), null);
  const rows = await scanPdfPage({ lines, render: noRender }, {}, noOllama);
  assert.equal(rows[0].qty, 30);
  assert.equal(rows[0]._scanMethod, 'PDF_TEXT_STRUCTURED');
  // Text without an item row but with a Qty field: the AI is used, and its "Pack of 2" reading is replaced by the field.
  const qtyField = ['amazon.in', 'Order ID: 406-0000000-0000002', 'Item SSC400-P2', 'Stainless Steel Airtight Container 400 ml, Pack of 2', 'Qty: 30', 'Grand Total: 11,940.00'];
  const ai = await scanPdfPage({ lines: qtyField, render: async () => 'image' }, {}, async () => ({ rows: [{ orderId: '406-0000000-0000002', sku: 'SSC400-P2', productName: 'Stainless Steel Airtight Container 400 ml, Pack of 2', qty: 2, saleAmount: 11940 }] }));
  assert.equal(ai[0].qty, 30);
  assert.equal(ai[0]._holds.qty, undefined);
  assert.ok(ai[0]._diag.verifyNotes.some(n => /AI read 2/.test(n)));
});

test('AI quantity that cannot be confirmed from a Qty field is flagged, never guessed', async () => {
  const lines = ['amazon.in', 'Order ID: 406-0000000-0000002', 'SKU: SSC400-P2', 'Stainless Steel Airtight Container 400 ml, Pack of 2', 'Grand Total: 11,940.00'];
  const rows = await scanPdfPage({ lines, render: async () => 'image' }, {}, async () => ({ rows: [{ orderId: '406-0000000-0000002', sku: 'SSC400-P2', qty: 2, saleAmount: 11940 }] }));
  assert.match(rows[0]._holds.qty, /could not be confirmed/);
  // Missing/invalid AI quantity is flagged too (never silently defaulted to 1).
  assert.equal(guardFallbackQuantity({ qty: 0, productName: 'Bottle' }, [], 1)._qtyUncertain, true);
  assert.equal(guardFallbackQuantity({ qty: '', productName: 'Bottle' }, [], 1)._qtyUncertain, true);
});

test('image labels: Qty equal to a title pack/size number is flagged; ordinary quantities pass', () => {
  const flagged = [['Container 400 ml, Pack of 2', 2], ['Pattern Discs Set of 6', 6], ['Bottle 500 ml', 500], ['Tray 2 x 3', 3], ['Spice Box 12 pcs', 12]];
  for (const [productName, qty] of flagged) {
    const r = guardFallbackQuantity({ qty, productName }, [], 1);
    assert.equal(r._qtyUncertain, true, `${productName} / ${qty}`);
  }
  const fine = [['Container 400 ml, Pack of 2', 1], ['Container 400 ml, Pack of 2', 30], ['Set of 6 Discs', 3], ['Plain bottle', 4]];
  for (const [productName, qty] of fine) {
    const r = guardFallbackQuantity({ qty, productName }, [], 1);
    assert.equal(r._qtyUncertain, undefined, `${productName} / ${qty}`);
    assert.equal(r.qty, qty);
  }
  assert.deepEqual([...titleNumbers('Steel Container 400 ml, Pack of 2')].sort((a, b) => a - b), [2, 400]);
});

test('normal Qty 1 labels are unchanged (Amazon, Flipkart "Set of 6", Meesho)', async () => {
  const real = JSON.parse(readFileSync(new URL('./test-fixtures/realPdfLines.json', import.meta.url), 'utf8'));
  for (const r of real) {
    const parsed = parsePdfLines(r.lines);
    if (!parsed) continue;
    assert.equal(parsed[0].qty, r.expected.qty, r.file);
  }
  // Flipkart title "Set of 6" with QTY 1: the AI reading 6 is corrected to the Qty field.
  const flipkart = real.find(r => r.expected.marketplace === 'Flipkart');
  assert.equal(structuredQuantity({ sku: flipkart.expected.sku }, flipkart.lines, 1), 1);
  assert.equal(guardFallbackQuantity({ sku: flipkart.expected.sku, qty: 6 }, flipkart.lines, 1).qty, 1);
  // Meesho table with a size that contains a number: Qty is the column before the colour.
  const meesho = ['SKU Size Qty Color Order No.', 'SSC-400 Pack of 2 3 Silver 330000000000000009_1'];
  assert.equal(structuredQuantity({ orderId: '330000000000000009_1' }, meesho, 1), 3);
  // Fast-parser samples with explicit Qty still parse as before.
  assert.equal(parsePdfLines(['amazon.in', 'Order ID: 408-0000000-0000001', 'SKU: ABC-1', 'Quantity: 1', 'Grand Total: INR 249.00'])[0].qty, 1);
});

test('safety: two Amazon items or mismatched totals still never use the fast path', () => {
  const two = amazonPack();
  two.splice(two.indexOf('HSN:73239390'), 0, '2 Another product |', 'B0CXYZ9999 ( OTHER-1 ) ₹100.00 1 ₹100.00 18% IGST ₹18.00 ₹118.00');
  assert.equal(parsePdfLines(two), null);
  const badTotal = amazonPack().map(l => l.startsWith('TOTAL:') ? 'TOTAL: ₹1,821.36 ₹11,000.00' : l);
  assert.equal(parsePdfLines(badTotal), null);
  // Conflicting quantity fields on a fallback page -> flagged.
  const conflict = [...amazonPack({ asinPrefix: 'x | ' }), 'Qty: 2'];
  assert.equal(guardFallbackQuantity({ sku: 'SSC400-P2', qty: 2 }, conflict, 1)._qtyUncertain, true);
});
