import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdfLines, scanPdfPage } from './fastPdfParser.js';
import { resolveScanRow } from './autoDetect.js';

// Synthetic table/order text in the pdf.js + itemsToLines layout (anonymised test data).
// Customer/address lines are omitted; no expected value is injected into parsing.
const fixtures = JSON.parse(readFileSync(new URL('./test-fixtures/realPdfLines.json', import.meta.url), 'utf8'));
const amazon = fixtures.find(f => f.expected.marketplace === 'Amazon');
function mappedContext(expected) {
  return { companies:[{id:'c'}], agents:[{id:'a',companyId:'c'}], accounts:[{id:'ac',agentId:'a',marketplace:expected.marketplace}], products:[{id:'p'}], productMaster:[{companyId:'c',marketplace:expected.marketplace,marketplaceSku:expected.sku,productId:'p',productName:'fixture product'}] };
}
for (const { file, lines, expected } of fixtures) {
  test(`real extracted text: ${file}`, async () => {
    const rows = parsePdfLines(lines);
    assert.ok(rows, 'real text must parse deterministically');
    assert.equal(rows.length, 1);
    for (const [field,value] of Object.entries(expected)) assert.equal(rows[0][field],value,field);
    // Explicitly synthetic mapping: this checks parser/routing, not live inventory.
    const scanned = await scanPdfPage({lines,render:()=>assert.fail('image rendering called')},mappedContext(expected),()=>assert.fail('Ollama called'));
    assert.equal(scanned[0]._scanMethod,'FAST_PDF_PARSER');
  });
}
test('Amazon invoice uses final total, never the tax column', () => {
  const rows = parsePdfLines(amazon.lines);
  assert.ok(rows);
  assert.equal(rows[0].saleAmount,249);
  assert.notEqual(rows[0].saleAmount,37.98);
});
test('Amazon invoice rejects missing/conflicting totals, quantities, and multiple items', () => {
  const item=amazon.lines.find(l=>l.startsWith('B0TESTAA01'));
  const cases=[
    amazon.lines.filter(l=>!l.startsWith('TOTAL:')),
    amazon.lines.map(l=>l.startsWith('TOTAL:') ? 'TOTAL: ₹37.98 ₹250.00' : l),
    amazon.lines.map(l=>l===item ? l.replace(' 1 ₹211.02',' 0 ₹211.02') : l),
    [...amazon.lines,'Quantity: 2'],
    [...amazon.lines,item],
    amazon.lines.map(l=>l===item ? l.replace('STM140001','') : l),
    amazon.lines.flatMap(l=>l.startsWith('TOTAL:') ? ['2 Another product',item,l] : [l])
  ];
  for (const lines of cases) assert.equal(parsePdfLines(lines),null);
});
test('Meesho exact reference skips Ollama while preserving missing mapping status', async () => {
  const {lines,expected}=fixtures.find(f=>f.expected.marketplace==='Meesho');
  const ctx=mappedContext(expected);ctx.productMaster=[];
  const scanned=await scanPdfPage({lines,render:()=>assert.fail('rendered')},ctx,()=>assert.fail('Ollama called'));
  assert.equal(scanned[0]._scanMethod,'FAST_PDF_PARSER');
  for (const [field,value] of Object.entries(expected)) assert.equal(scanned[0][field],value);
  assert.equal(resolveScanRow(scanned[0],ctx).status,'Not Found');
  assert.equal(ctx.productMaster.length,0);
});
