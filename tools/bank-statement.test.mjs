import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import express from 'express';
import { parseStatement, buildPreview, moneyCents, bankDate, fingerprint, duplicateCheck, detectMarketplace } from '../server/bankStatement.mjs';
import { advisePreview, validateSuggestions } from '../server/bankStatementAi.mjs';
import { registerBankStatementRoutes } from '../server/bankStatementRoutes.mjs';
import { updatePreviewRow, previewTotals, maskBankText, combineBankPreviews, settlementDetectionResults } from '../client/src/bankPreview.js';
import { headers, statementRows, statementPdfPages, iobStatementPages } from './fixtures/banking-statements.mjs';

function workbookInput(month = '08', type = 'xlsx', reverse = false) {
  const { rows, footer } = statementRows(month);
  const sheet = XLSX.utils.aoa_to_sheet([['Indian Overseas Bank'], ['Account No: 00000000001234'], headers, ...(reverse ? rows.toReversed() : rows), footer]);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Statement');
  return { filename: `synthetic-${month}.${type}`, base64: XLSX.write(book, { type: 'buffer', bookType: type }).toString('base64') };
}

test('Indian money and real calendar dates: blanks, lakh commas, decimals, Excel dates, invalid precision', () => {
  assert.equal(moneyCents('₹1,23,456.78'),12345678); assert.equal(moneyCents('1,234,567.89 CR'),123456789);
  assert.equal(moneyCents(''),0); assert.equal(bankDate('31/08/2026'),'2026-08-31'); assert.equal(bankDate('01-Sep-26'),'2026-09-01');
  assert.equal(bankDate('31/09/2026'),null); assert.ok(bankDate(46235));
  for (const amount of ['1,2,3', '1.001', 'NaN', '1e4', '99999999999999999']) assert.throws(()=>moneyCents(amount));
});

for (const type of ['csv','xlsx']) test(`${type}: synthetic August/September counts and totals reconcile, reverse ordering preserved`, () => {
  for (const month of ['08','09']) {
    const input=workbookInput(month,type,month==='09');const parsed=parseStatement(input);
    assert.equal(parsed.transactions.length,9);assert.equal(parsed.warnings.length,0,JSON.stringify(parsed.warnings));
    assert.equal(parsed.reconciliation.extracted.creditCents,statementRows(month).totalCredit);assert.equal(parsed.reconciliation.verified,true);
    assert.equal(parsed.reconciliation.checks.balances,true); assert.equal(parsed.transactions[0].date,month==='09'?'2026-09-09':'2026-08-01');
    const preview=buildPreview(parsed);assert.equal(preview.rows.filter(row=>row.detection.marketplace==='Meesho').length,3);
    assert.equal(preview.rows.filter(row=>row.detection.marketplace==='Amazon').length,1);assert.equal(preview.rows.filter(row=>row.detection.marketplace==='Flipkart').length,1);
    assert.equal(preview.rows.filter(row=>row.status==='Review required').length,1);assert.equal(preview.rows.filter(row=>row.status==='Other / Excluded').length,3);
    assert.equal(preview.rows.some(row=>row.approved),false); assert.equal(preview.savingEnabled,false);
  }
});

test('multi-page PDF geometry, multiline narration, repeated headers, duplicate rows and source provenance',()=>{
  const parsed=parseStatement({filename:'synthetic.pdf',pages:statementPdfPages()});
  assert.equal(parsed.transactions.length,10);assert.equal(parsed.warnings.length,0,JSON.stringify(parsed.warnings));
  const preview=buildPreview(parsed);assert.equal(preview.rows.filter(row=>row.duplicate).length,1);
  assert.equal(parsed.reconciliation.extracted.count,9);assert.equal(parsed.reconciliation.verified,true);
  assert.equal(preview.rows[0].narration,'NEFT/MEESHO TEC-/CUST/\nMEE');assert.equal(preview.rows[0].sources.length,2);
  assert.equal(preview.rows[0].originalRows.length,2);assert.equal(preview.rows[0].sources[0].page,1);
  assert.equal(preview.rows[0].accountKey.length,64);assert.ok(!preview.rows[0].accountKey.includes('1234'));
});

test('IOB observed layout: split headers/value dates, centered headers, right-aligned money, continuation pages and footer totals',()=>{
  for(const month of ['08','09']) {
    const pages=iobStatementPages(month),parsed=parseStatement({filename:'synthetic.pdf',pages});
    assert.equal(parsed.transactions.length,9);assert.equal(parsed.reconciliation.verified,true,JSON.stringify(parsed.warnings));
    assert.equal(parsed.accountAvailable,true);assert.match(parsed.reconciliation.countBasis,/date blocks/);
    assert.equal(parsed.reconciliation.sourceTotals.creditCents,statementRows(month).totalCredit);
    assert.equal(parsed.transactions[0].valueDate,`2026-${month}-01`);
    assert.equal(parsed.transactions[0].reference,'TEST-UTR-1');assert.equal(parsed.transactions[0].sources.length,3);
    assert.equal(parsed.transactions.filter(row=>row.narration.includes('\n')).length,9);
    assert.equal(buildPreview(parsed).rows.filter(row=>row.detection.marketplace==='Meesho').length,3);
    // Missing balance is visible and cannot accidentally become a reconciled scan.
    const broken=structuredClone(pages);broken[2].items=broken[2].items.filter(item=>!(item.x===533&&item.y===790));
    const failed=parseStatement({filename:'synthetic.pdf',pages:broken});assert.equal(failed.reconciliation.verified,false);assert.ok(failed.warnings.some(warning=>warning.code==='SOURCE_COUNT_MISMATCH'));
  }
});

test('actual in-memory multi-page PDF bytes extract through PDF.js and reconcile synthetic source totals',async()=>{
  const pages=statementPdfPages();
  const escape=text=>text.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((page,index)=>{
    const content=page.items.map(item=>`BT /F1 8 Tf 1 0 0 1 ${item.x} ${item.y} Tm (${escape(item.text)}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  let data='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(data));data+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(data);data+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdfjs=await import('../client/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=await pdfjs.getDocument({data:new Uint8Array(Buffer.from(data)),useSystemFonts:true}).promise;
  try {
    const extracted=[];
    for(let number=1;number<=pdf.numPages;number++) { const page=await pdf.getPage(number);const content=await page.getTextContent();extracted.push({pageNumber:number,items:content.items.filter(item=>item.str.trim()).map(item=>({text:item.str,x:item.transform[4],y:item.transform[5]}))}); }
    const parsed=parseStatement({filename:'synthetic.pdf',pages:extracted});
    assert.equal(parsed.transactions.length,10);assert.equal(parsed.reconciliation.verified,true,JSON.stringify(parsed.warnings));assert.equal(buildPreview(parsed).rows.filter(row=>row.duplicate).length,1);
  } finally { await pdf.destroy(); }
});

test('OCR, unreadable rows, absent totals, mismatched totals and unsupported headers fail visibly',()=>{
  const empty=parseStatement({filename:'scan.pdf',pages:[{pageNumber:1,items:[]}]});assert.ok(empty.warnings.some(row=>row.code==='OCR_REQUIRED'));assert.equal(empty.reconciliation.verified,false);
  const {rows,footer}=statementRows();const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,rows[0],['bad date','','Unknown','REF','','12.345',''],['','','orphan','','','10',''],[...footer.slice(0,5),'1.00','']]),'Sheet');
  const parsed=parseStatement({filename:'bad.xlsx',base64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')});
  assert.ok(parsed.warnings.some(row=>row.code==='UNREADABLE_ROW'));assert.ok(parsed.warnings.some(row=>row.code==='TOTAL_MISMATCH'));assert.equal(parsed.reconciliation.verified,false);
  const unknown=parseStatement({filename:'bad.csv',base64:Buffer.from('Date,Description,Amount\n01/08/2026,Unknown,123\n').toString('base64')});assert.ok(unknown.warnings.some(row=>row.code==='UNSUPPORTED_HEADER'));
});

test('conservative rules never infer INTERNAL A-DAS or unknown NEFT as Flipkart, debits never qualify',()=>{
  const row={creditCents:10000,debitCents:0};
  for (const narration of ['INTERNAL A-DAS','NEFT/UNKNOWN','FLIPKART unverified','AMAZON unverified','IMPS/PERSON']) assert.equal(detectMarketplace({...row,narration}).marketplace,null);
  assert.equal(detectMarketplace({...row,narration:'NEFT/MEESHO PAY',debitCents:100}).status,'Other / Excluded');
});

test('stable fingerprint and persistent legacy/import duplicates, including deleted receipts',()=>{
  const row=parseStatement(workbookInput()).transactions[0];
  assert.equal(fingerprint(row),fingerprint({...row,narration:row.narration.toLowerCase().replaceAll(' ','  ')}));
  assert.notEqual(fingerprint(row),fingerprint({...row,accountKey:'different-account'}));
  const stored=[{transactionFingerprint:fingerprint(row),deletedAt:'2026-10-01'}];assert.match(duplicateCheck(row,stored).duplicate,/Previously imported/);
  const legacy=[{date:row.date,amountCents:row.creditCents,reference:row.reference}];assert.match(duplicateCheck(row,legacy).duplicate,/legacy/);
  assert.match(buildPreview(parseStatement(workbookInput()),legacy).rows[0].duplicate,/legacy/);
});

test('AI strictly advisory: schema validation, malformed JSON, unavailability, remote URL rejection',async()=>{
  const preview=buildPreview(parseStatement(workbookInput()));const before=structuredClone(preview);
  const uncertain=preview.rows.find(row=>row.status==='Review required');
  const suggestion={id:uncertain.id,marketplace:'Flipkart',confidence:0.99,explanation:'Additional evidence needed',reviewRequired:true};
  let request;
  const advised=await advisePreview(preview,{fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({response:JSON.stringify({suggestions:[suggestion]})})};}});
  assert.equal(advised.rows.find(row=>row.id===uncertain.id).status,'Review required');assert.equal(advised.rows.find(row=>row.id===uncertain.id).marketplace,null);
  assert.equal(advised.rows.some(row=>row.approved),false);assert.deepEqual(preview,before);assert.ok(!request.prompt.includes('00000000001234'));
  for (const rows of [[{...suggestion,creditCents:1}],[{...suggestion,reviewRequired:false}],[{...suggestion,confidence:2}],[]]) assert.throws(()=>validateSuggestions({suggestions:rows},[uncertain.id]));
  for (const fetchImpl of [async()=>{throw new Error('offline');},async()=>({ok:true,json:async()=>({response:'not json'})})]) {
    const fallback=await advisePreview(preview,{fetchImpl});assert.deepEqual(fallback.rows,preview.rows);assert.match(fallback.aiStatus,/unavailable/);
  }
  let called=false;await advisePreview(preview,{settings:{url:'https://external.example',model:'x'},fetchImpl:async()=>{called=true;}});assert.equal(called,false);
  await advisePreview(preview,{settings:{url:'http://127.0.0.1:11434',model:'gpt-oss:120b-cloud'},fetchImpl:async()=>{called=true;}});assert.equal(called,false);
});

test('Ollama bounded batches retain successful suggestions when a later batch is malformed',async()=>{
  const original=buildPreview(parseStatement(workbookInput()));
  const uncertain=original.rows.find(row=>row.status==='Review required');
  const preview={...original,rows:Array.from({length:6},(_,index)=>({...uncertain,id:`ai-${index}`}))};
  let calls=0;
  const advised=await advisePreview(preview,{fetchImpl:async(_url,options)=>{
    calls++;const prompt=JSON.parse(options.body).prompt;
    const transactions=JSON.parse(prompt.split('Transactions: ')[1]);
    if(calls===2) return {ok:true,json:async()=>({response:'invalid'})};
    return {ok:true,json:async()=>({response:JSON.stringify({suggestions:transactions.map(row=>({id:row.id,marketplace:'Unknown',confidence:0,explanation:'Need evidence',reviewRequired:true}))})})};
  }});
  assert.equal(calls,2);assert.equal(advised.rows.filter(row=>row.ai).length,4);assert.equal(advised.rows.every(row=>!row.approved&&row.marketplace===null),true);assert.match(advised.aiStatus,/incomplete/);
});

test('explicit preview approval, manual changes and AI adoption do not save; debits/duplicates blocked',()=>{
  const preview=buildPreview(parseStatement(workbookInput()));const row=preview.rows[0];
  assert.equal(previewTotals(preview.rows).Meesho,0);
  const approved=updatePreviewRow(row,'approve');assert.equal(approved.classificationSource,'Rule');assert.equal(previewTotals([approved]).Meesho,row.creditCents);
  const manual=updatePreviewRow(approved,'marketplace','Amazon');assert.equal(manual.approved,false);assert.equal(updatePreviewRow(manual,'approve').classificationSource,'Manual');
  const ai=updatePreviewRow({...row,marketplace:null,ai:{marketplace:'Flipkart'}},'ai');assert.equal(ai.approved,false);assert.equal(updatePreviewRow(ai,'approve').classificationSource,'Ollama Suggested');
  assert.equal(updatePreviewRow(approved,'exclude').approved,false);assert.equal(updatePreviewRow(approved,'review').approved,false);
  const duplicate={...row,duplicate:'Existing'};assert.deepEqual(updatePreviewRow(duplicate,'approve'),duplicate);
  const debit=preview.rows.at(-1);assert.deepEqual(updatePreviewRow(debit,'approve','Amazon'),debit);
  assert.ok(!maskBankText('Account 00000000001234').includes('00000000001234'));
});

test('detection-only summary excludes ambiguous/AI/debit/unrelated/duplicate rows and supports explicit corrections without import approval',()=>{
 const scan=buildPreview(parseStatement(workbookInput()));const before=structuredClone(scan);
 const combined=combineBankPreviews([scan]);let results=settlementDetectionResults(combined.rows);
 assert.equal(results.confirmed.length,5);assert.equal(results.review.length,1);assert.equal(results.hiddenCount,3);
 assert.deepEqual(results.summaries.map(group=>group.count),[1,1,3]);
 const ambiguous=combined.rows.find(row=>row.status==='Review required');
 const withAi={...ambiguous,ai:{marketplace:'Flipkart',confidence:1}};
 assert.equal(settlementDetectionResults([withAi]).totalCents,0);
 const selected=updatePreviewRow(withAi,'ai');assert.equal(settlementDetectionResults([selected]).totalCents,0);
 const confirmed=updatePreviewRow(selected,'confirmDetection');assert.equal(confirmed.approved,false);assert.equal(settlementDetectionResults([confirmed]).totalCents,ambiguous.creditCents);
 const corrected=updatePreviewRow(combined.rows[0],'correct','Amazon');assert.equal(corrected.approved,false);assert.equal(corrected.classificationSource,'Manual');
 assert.equal(settlementDetectionResults([corrected]).summaries[0].count,1);
 assert.equal(settlementDetectionResults([updatePreviewRow(corrected,'review')]).totalCents,0);
 assert.equal(settlementDetectionResults(combineBankPreviews([scan,scan]).rows).confirmed.length,5);
 assert.deepEqual(scan,before);
});

test('HTTP preview never changes storage; explicit confirm remains blocked with zero saved, including repeat uploads',async t=>{
  const db={bankSettlements:[{id:'legacy',date:'2026-08-01',amountCents:10000,reference:'TEST-UTR-1'}],ledger:[{id:'untouched'}]};const before=structuredClone(db);
  const app=express();app.use(express.json());registerBankStatementRoutes(app,{readDb:()=>structuredClone(db),advise:async preview=>({...preview,aiStatus:'test offline'})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}/api/banking/statement`;
  const post=(path,body)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  for(let count=0;count<2;count++) {const response=await post('/preview',workbookInput());assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.rows[0].status,'Duplicate');assert.equal(preview.savingEnabled,false);}
  for (const body of [{},{confirm:true,approvedRows:[{marketplace:'Amazon',creditCents:100}]}]) {const response=await post('/import',body);assert.equal(response.status,409);assert.equal((await response.json()).saved,0);}
  assert.deepEqual(db,before);
});
