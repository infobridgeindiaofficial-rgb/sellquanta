import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanPerf } from './scanPerf.js';
import { scanPdfPage } from './fastPdfParser.js';
import { resolveScanRow } from './autoDetect.js';

test('live diagnostics preserve fast row and prove image/Ollama preparation skipped',async ()=>{
  const logs=[];const info=console.info;console.info=line=>logs.push(JSON.parse(line.slice('[SCAN_PERF] '.length)));
  try {
    const perf=createScanPerf('test','label.pdf',1);
    const lines=['amazon.in','408-0000000-0000001','SKU: ABC','Quantity: 1','Total: 249.00'];
    const rows=await scanPdfPage({lines,render:()=>assert.fail('rendered')},{},()=>assert.fail('Ollama called'),perf);
    assert.equal(rows[0]._scanMethod,'FAST_PDF_PARSER');
    const ctx={companies:[],agents:[],accounts:[],products:[],productMaster:[]};
    const mapped=perf.sync('product_company_agent_account_resolution',()=>resolveScanRow(rows[0],ctx,perf));
    assert.equal(mapped.status,'Not Found');
    for(const stage of ['marketplace_detection_end','fastPdfParser_end','fallback_decision_end','fallback_preparation_skipped','resolution_marketplace_detection_end','product_company_agent_account_resolution_end']) assert.ok(logs.some(l=>l.stage===stage),stage);
    assert.equal(perf.state.ollamaCalled,false);
    assert.equal(perf.state.imageRendered,false);
    assert.equal(perf.state.imageRenderStarted,false);
    assert.ok(logs.every(l=>l.timestamp && Number.isFinite(l.elapsedMs)));
    assert.ok(!logs.some(l=>l.stage==='ollama_request_start'));
  } finally {console.info=info;}
});
test('fallback diagnostics time the actual request and preserve failures',async ()=>{
  const logs=[];const info=console.info;console.info=line=>logs.push(JSON.parse(line.slice('[SCAN_PERF] '.length)));
  try {
    const perf=createScanPerf('test','empty.pdf',1);
    await assert.rejects(scanPdfPage({lines:[],render:async ()=>'image'},{},async body=>{
      assert.equal(body.imageBase64,'image');throw new Error('offline');
    },perf),/offline/);
    assert.equal(perf.state.parserSource,'OLLAMA_FALLBACK');
    assert.equal(perf.state.ollamaCalled,true);
    assert.ok(logs.some(l=>l.stage==='ollama_request_start'));
    assert.ok(logs.some(l=>l.stage==='ollama_request_end' && l.error==='offline'));
  } finally {console.info=info;}
});
