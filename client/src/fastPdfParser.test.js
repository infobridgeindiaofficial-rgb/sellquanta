import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdfLines, scanPdfPage } from './fastPdfParser.js';
import { resolveScanRow } from './autoDetect.js';

const samples = {
  Amazon: ['amazon.in', 'Order ID: 408-0000000-0000001', 'SKU: ABC-1', 'Quantity: 2', 'Grand Total: INR 1,234.50'],
  Flipkart: ['E-Kart Logistics', 'OD123456789012345', 'SKU ID | Description QTY', '1 ABC-1 | Example product 2', 'TOTAL QTY: 2', 'TOTAL PRICE: 1234.50'],
  Meesho: ['Original For Recipient', 'SKU Size Qty Color Order No.', 'ABC-1 Free Size 2 Blue 330000000000000009_1', 'Total Amount: Rs. 1,234.50']
};
function context(marketplace) {
  return { companies: [{id:'c'}], agents: [{id:'a',companyId:'c'}], accounts: [{id:'ac',agentId:'a',marketplace}], products: [{id:'p'}], productMaster: [{companyId:'c',marketplace,marketplaceSku:'ABC-1',productId:'p',productName:'Example product'}] };
}
for (const [marketplace, lines] of Object.entries(samples)) {
  test(`${marketplace}: extracts required fields without Ollama or rendering`, async () => {
    const parsed = parsePdfLines(lines);
    assert.equal(parsed[0].marketplace, marketplace);
    assert.equal(parsed[0].sku, 'ABC-1');
    assert.equal(parsed[0].qty, 2);
    assert.equal(parsed[0].saleAmount, 1234.5);
    const result = await scanPdfPage({lines, render:()=>assert.fail('rendered')}, context(marketplace), ()=>assert.fail('Ollama called'));
    assert.equal(result[0]._scanMethod, 'FAST_PDF_PARSER');
  });
}
test('missing fields, conflicting quantities/totals, multiple orders and unknown layouts fall back', () => {
  for (const lines of [[], samples.Amazon.slice(0,-1), samples.Amazon.filter(l=>!l.startsWith('Quantity')), [...samples.Amazon,'Quantity: 3'], [...samples.Amazon,'Total Amount: 500.00'], [...samples.Amazon,'408-0000000-0000002'], [...samples.Amazon,'OD123456789012345'], samples.Flipkart.filter(l=>!l.includes('TOTAL PRICE')), samples.Meesho.filter(l=>!l.includes('Total Amount'))]) {
    assert.equal(parsePdfLines(lines), null, lines.join('\n'));
  }
});
test('unmapped rows retain fast extraction and existing Not Found status', async () => {
  const ctx = context('Amazon'); ctx.productMaster = [];
  const result = await scanPdfPage({lines:samples.Amazon, render:()=>assert.fail('rendered')},ctx,()=>assert.fail('Ollama called'));
  assert.equal(result[0]._scanMethod,'FAST_PDF_PARSER');
  assert.equal(resolveScanRow(result[0],ctx).status,'Not Found');
  assert.equal(ctx.productMaster.length,0);
});
test('mixed pages make independent routing decisions and retain text for mapping', async () => {
  let calls=0;
  for (const lines of [samples.Amazon, [], samples.Amazon]) {
    const rows = await scanPdfPage({lines,render:async ()=>'image'},context('Amazon'),async ()=>{calls++;return {rows:[{sku:'ABC-1'}]};});
    assert.equal(rows[0]._docText,lines.join(' '));
  }
  assert.equal(calls,1);
});
test('missing agents/accounts retain fast extraction and Needs Review status', async () => {
  for (const field of ['agents','accounts']) {
    const ctx=context('Amazon'); ctx[field]=[];
    const rows=await scanPdfPage({lines:samples.Amazon,render:()=>assert.fail('rendered')},ctx,()=>assert.fail('Ollama called'));
    assert.equal(rows[0]._scanMethod,'FAST_PDF_PARSER');
    assert.equal(resolveScanRow(rows[0],ctx).status,'Needs Review');
  }
});
test('scan queue continues appending and file selection/clearing never resets rows', () => {
  const app=readFileSync(new URL('./App.jsx',import.meta.url),'utf8');
  const handlers=app.slice(app.indexOf('const chooseFiles ='),app.indexOf('const runScan ='));
  assert.doesNotMatch(handlers,/setScanRows/);
  assert.match(app,/setScanRows\(x => batchPerf\.sync\('scanRows_append_update',\(\) => \[\.\.\.x, \.\.\.rows\]/);
});
test('fallback failure does not affect later independent pages', async () => {
  await assert.rejects(scanPdfPage({lines:[],render:async ()=>'image'},context('Amazon'),async ()=>{throw new Error('offline');}), /offline/);
  const rows=await scanPdfPage({lines:samples.Amazon,render:()=>assert.fail()},context('Amazon'),()=>assert.fail());
  assert.equal(rows[0]._scanMethod,'FAST_PDF_PARSER');
});
