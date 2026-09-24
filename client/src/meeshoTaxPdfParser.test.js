import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdfLines, scanPdfPage } from './fastPdfParser.js';
import { createScanPerf } from './scanPerf.js';
import { resolveScanRow } from './autoDetect.js';

// Synthetic pdf.js-style lines in the Meesho tax-invoice layout (anonymised test data).
const fixtures=JSON.parse(readFileSync(new URL('./test-fixtures/meeshoTaxPdfLines.json',import.meta.url),'utf8'));
const expected={
  '00000001':['330000000000000006_1','tst01-SkuA00000001',369],
  '00000002':['330000000000000001_1','tst01-SkuA00000001',344.13],
  '00000003':['330000000000000004_1','tst01-SkuA00000002',248.74],
  '00000004':['330000000000000005_1','tst01-SkuA00000001',338.28],
  '00000005':['330000000000000007_1','tst01-SkuA00000001',336.10],
  '00000006':['330000000000000002_1','tst01-SkuA00000003',208],
  '00000007':['330000000000000008_1','tst01-SkuA00000004',145.53]
};
for(const {file,lines} of fixtures) {
  test(`Meesho tax invoice: ${file}`,async ()=>{
    const [orderId,sku,saleAmount]=expected[file.split('_')[3].slice(0,8)];
    const parsed=parsePdfLines(lines);
    assert.ok(parsed,'tax invoice text must parse');
    assert.equal(parsed.length,1);
    for(const [field,value] of Object.entries({marketplace:'Meesho',orderId,sku,qty:1,saleAmount})) assert.equal(parsed[0][field],value,field);
    const perf=createScanPerf('regression',file,1);
    const rows=await scanPdfPage({lines,render:()=>assert.fail('image render started')},{},()=>assert.fail('Ollama called'),perf);
    assert.equal(rows[0]._scanMethod,'FAST_PDF_PARSER');
    assert.deepEqual(perf.state,{parserSource:'FAST_PDF_PARSER',ollamaCalled:false,imageRendered:false,imageRenderStarted:false});
    const status=resolveScanRow(rows[0],{companies:[],agents:[],accounts:[],products:[],productMaster:[]}).status;
    assert.equal(status,'Not Found');
  });
}
test('Meesho tax totals still reject absent or conflicting amounts and unknown table layouts',()=>{
  const lines=fixtures[0].lines;
  for(const invalid of [
    lines.filter(l=>!/^Total Rs\./.test(l)),
    [...lines,'Total Rs.17.58 Rs.999.00'],
    [...lines,'Total Amount: 999.00'],
    lines.filter(l=>!l.startsWith('Description HSN')),
    lines.map(l=>l.startsWith('Total Rs.') ? 'Total Rs.17.58 Rs.369.00 Rs.999.00' : l)
  ]) assert.equal(parsePdfLines(invalid),null);
});
