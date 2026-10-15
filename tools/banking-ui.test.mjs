import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
import { parseStatement, buildPreview } from '../server/bankStatement.mjs';
import { statementPdfPages } from './fixtures/banking-statements.mjs';
import express from 'express';
import {registerBankStatementRoutes} from '../server/bankStatementRoutes.mjs';
import {createBankReceiptPersistence} from '../server/bankReceiptImport.mjs';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/banking-ui-components-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__exportApi;';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{}; export const fileToImageDataUrls=()=>{};';
  if(file==='bankStatementFile.js') code='export const statementInput=async file=>globalThis.__bankStatementInputs?.[file.name]||({filename:file.name,base64:"test"});';
  if(file==='Banking.jsx') code=code.replace("import('./bankStatementFile.js')","import('./bankStatementFile.mjs')");
  if(file==='App.jsx') code+='\nexport {Dashboard};';
  code=code.replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name.replace(/\.(js|jsx)$/,'')}.mjs${q}`)
    .replace(/from (["'])react\1/g,`from '${pathToFileURL(path.join(project,'client/node_modules/react/index.js')).href}'`);
  fs.writeFileSync(path.join(compiled,file.replace(/\.(js|jsx)$/,'.mjs')),(await transform(code,{loader:file.endsWith('.jsx')?'jsx':'js',format:'esm'})).code);
}
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5173'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;
globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('../client/node_modules/react/index.js');
const {act}=React;
const {createRoot}=await import('../client/node_modules/react-dom/client.js');
globalThis.__exportApi={bankReceiptHistory:async()=>({receipts:[],reconciliation:null})};
const {default:App}=await import(pathToFileURL(path.join(compiled,'App.mjs')));


const state={companies:[{id:'c',name:'Company'}],products:[],agents:[],accounts:[],ledger:[],productMaster:[],refunds:[],salesHistory:[],todaySales:[],bankSettlements:[{id:'existing',amountCents:10000}]};
test('Banking navigation and preparation UI perform no writes or receipt mutations',async()=>{
 const before=structuredClone(state);let reads=0;
 globalThis.__exportApi.state=async()=>{reads++;return state;};
 globalThis.__exportApi.health=async()=>({ollama:{ok:false}});
 const root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(App)));
 const nav=[...document.querySelectorAll('nav button')];
 const agentIndex=nav.findIndex(b=>b.textContent==='Agents & Wallet');
 assert.equal(nav[agentIndex+1].textContent,'Banking');
 assert.ok(nav[agentIndex+1].querySelector('svg path'));
 await act(async()=>nav[agentIndex+1].click());
 assert.equal(document.querySelector('h1').textContent,'Banking');
 assert.equal(document.querySelector('nav [aria-current="page"]').textContent,'Banking');
 assert.deepEqual([...document.querySelectorAll('.banking-summary .banking-marketplace-card h4')].map(el=>el.textContent),['Amazon','Flipkart','Meesho','TOTAL']);
 assert.deepEqual([...document.querySelectorAll('.banking-form select option')].map(el=>el.textContent),['Amazon','Flipkart','Meesho']);
 assert.equal(document.querySelectorAll('.banking-page button:not(:disabled)').length,0);
 assert.equal(document.querySelector('.banking-page input[type="file"]').accept,'.pdf,.csv,.xlsx');
 assert.equal(document.querySelector('.banking-page input[type="file"]').disabled,false);
 assert.equal(document.querySelectorAll('.banking-page tbody tr').length,3);
 assert.equal(document.querySelectorAll('.banking-page tbody tr td').length,3);
 document.querySelector('[name="receivedAmount"]').value='123.45';
 await act(async()=>document.querySelector('.banking-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.deepEqual(state,before);assert.equal(reads,2);
 let previews=0;
 globalThis.__exportApi.bankStatementPreview=async()=>{previews++;return {...buildPreview(parseStatement({filename:'synthetic.pdf',pages:statementPdfPages()})),aiStatus:'Ollama offline; manual review required'};};
 const upload=document.querySelector('.banking-page input[type="file"]');
 await act(async()=>{Object.defineProperty(upload,'files',{value:[new dom.window.File(['synthetic'],'synthetic.pdf')],configurable:true});upload.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 const scan=[...document.querySelectorAll('.banking-page button')].find(button=>button.textContent==='Scan Statement');
 assert.equal(scan.disabled,false);
 await act(async()=>scan.click());
 assert.equal(previews,1);
 assert.equal(document.querySelectorAll('[aria-label="Detected marketplace credits"] tbody tr').length,5);
 assert.equal(document.querySelectorAll('[aria-label="Credits needing review"] tbody tr').length,1);
 assert.deepEqual([...document.querySelectorAll('[aria-label="Detected marketplace credits"] th')].map(cell=>cell.textContent),['Date','Marketplace','Bank Narration','Reference Number','Received Amount','Detection Status']);
 const firstRow=document.querySelector('[aria-label="Detected marketplace credits"] tbody tr');
 assert.ok(firstRow.textContent.includes('Rule confirmed'));
 const selector=firstRow.querySelector('select');
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(selector,'Amazon');selector.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.ok(firstRow.textContent.includes('Manually corrected'));
 assert.ok(document.querySelector('[data-marketplace="Meesho"]').textContent.includes('2 confirmed transaction(s)'));
 const confirm=[...document.querySelectorAll('.banking-page button')].find(button=>button.textContent==='Confirm & Save');assert.equal(confirm.disabled,true);
 assert.deepEqual(state,before);assert.equal(reads,2);
 const css=fs.readFileSync(path.join(project,'client/src/styles.css'),'utf8');
 assert.match(css,/@media \(max-width: 600px\)/);assert.match(css,/\.banking-page \.form-grid, \.banking-page \.stats.cols-3 \{ grid-template-columns: minmax\(0, 1fr\)/);
 await act(async()=>root.unmount());
});

test('Banking verified selection saves only confirmed credits, retains exclusions, filters real history and persists on remount',async t=>{
 const businessBytes=fs.readFileSync(path.join(project,'data/stockpilot.json'));
 const dir=fs.mkdtempSync(path.join(project,'tmp/banking-save-ui-')),file=path.join(dir,'db.json');
 const legacy={id:'existing',date:'2026-10-12',marketplace:'Meesho',amountCents:12345,version:1};
 fs.writeFileSync(file,JSON.stringify({...state,bankSettlements:[legacy]}));
 const app=express();app.use(express.json());registerBankStatementRoutes(app,{readDb:()=>JSON.parse(fs.readFileSync(file)),persist:createBankReceiptPersistence({dbFile:file,backupDir:path.join(dir,'backups')}),advise:async preview=>({...preview,aiStatus:'Synthetic offline'})});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}/api/banking`;
 const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;};
 let saveCalls=0,pendingHistory,pendingScan,pendingSave;
 Object.assign(globalThis.__exportApi,{state:async()=>state,health:async()=>({ollama:{ok:false}}),bankReceiptHistory:()=>{pendingHistory=(async()=> (await fetch(base+'/receipts')).json())();return pendingHistory;},bankStatementPreview:body=>{pendingScan=post('/statement/preview',body);return pendingScan;},saveBankReceipts:body=>{saveCalls++;pendingSave=post('/statement/import',body);return pendingSave;}});
 globalThis.__bankStatementInputs={'synthetic.pdf':{filename:'synthetic.pdf',pages:statementPdfPages(),useOllama:false}};
 let root=createRoot(document.getElementById('root'));
 const enter=async()=>{await act(async()=>root.render(React.createElement(App)));await act(async()=>[...document.querySelectorAll('nav button')].find(button=>button.textContent==='Banking').click());await act(async()=>{await pendingHistory;});};
 await enter();
 const clickText=async(text,container=document)=>{await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent===text).click());};
 const change=async(element,value)=>{await act(async()=>{Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
 const upload=document.querySelector('.banking-page input[type="file"]');
 await act(async()=>{Object.defineProperty(upload,'files',{value:[new dom.window.File(['synthetic'],'synthetic.pdf')],configurable:true});upload.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 await clickText('Scan Statement');await act(async()=>{await pendingScan;});
 const saveButton=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm & Save');assert.equal(saveButton().disabled,true);
 await clickText('Needs Review',document.querySelector('[aria-label="Detected marketplace credits"] tbody tr'));
 await clickText('Exclude',document.querySelector('[aria-label="Credits needing review"] tbody tr'));
 const verification=document.querySelectorAll('.banking-scanner-controls input[type="checkbox"]')[1];
 await act(async()=>verification.click());assert.equal(saveButton().disabled,false);
 await act(async()=>{saveButton().click();saveButton()?.click();await pendingSave;await Promise.resolve();await pendingHistory;});
 assert.equal(saveCalls,1);assert.ok(document.body.textContent.includes('Saved 4 receipt(s)'));
 const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.bankSettlements.length,5);assert.deepEqual(saved.bankSettlements[0],legacy);
 assert.ok(!saved.bankSettlements.some(receipt=>receipt.reference==='TEST-UTR-1'));assert.ok(!saved.bankSettlements.some(receipt=>receipt.reference==='TEST-UTR-6'));
 assert.equal(document.querySelectorAll('[aria-label="Bank receipt history"] tbody tr').length,5);
 const savedCards=document.querySelectorAll('[aria-label="Saved receipt totals"] .stat-value');assert.deepEqual([...savedCards].map(card=>card.textContent),['₹104.00','₹103.00','₹326.45']);
 const labelInput=text=>[...document.querySelectorAll('label')].find(label=>label.firstChild?.textContent===text)?.querySelector('select,input');
 await change(labelInput('History month'),'2026-08');assert.equal(document.querySelectorAll('[aria-label="Bank receipt history"] tbody tr').length,4);
 await change(labelInput('History marketplace'),'Amazon');assert.equal(document.querySelectorAll('[aria-label="Bank receipt history"] tbody tr').length,1);
 assert.deepEqual([...document.querySelectorAll('[aria-label="Saved receipt totals"] .stat-value')].map(card=>card.textContent),['₹104.00','₹0.00','₹0.00']);
 await change(labelInput('History period'),'dateRange');await change(labelInput('History from date'),'2026-08-05');await change(labelInput('History to date'),'2026-08-05');assert.equal(document.querySelectorAll('[aria-label="Bank receipt history"] tbody tr').length,1);
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await enter();assert.equal(document.querySelectorAll('[aria-label="Bank receipt history"] tbody tr').length,5);
 assert.ok(document.querySelector('[aria-label="Saved receipt totals"]').textContent.includes('Amazon saved'));
 await act(async()=>root.unmount());delete globalThis.__bankStatementInputs;
 assert.ok(businessBytes.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))));
});

test('Manual Save Receipt validates, writes once, immediately refreshes history/totals, rejects duplicates and survives refresh',async t=>{
 const originalBusiness=fs.readFileSync(path.join(project,'data/stockpilot.json'));
 const dir=fs.mkdtempSync(path.join(project,'tmp/manual-bank-ui-')),file=path.join(dir,'db.json');fs.writeFileSync(file,JSON.stringify({...state,bankSettlements:[]}));
 const app=express();app.use(express.json());registerBankStatementRoutes(app,{readDb:()=>JSON.parse(fs.readFileSync(file)),persist:createBankReceiptPersistence({dbFile:file,backupDir:path.join(dir,'backups')})});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}/api/banking`;
 let pendingHistory,pendingSave,calls=0;
 Object.assign(globalThis.__exportApi,{state:async()=>state,health:async()=>({ollama:{ok:false}}),bankReceiptHistory:()=>{pendingHistory=(async()=> (await fetch(base+'/receipts')).json())();return pendingHistory;},saveManualBankReceipt:body=>{
   calls++;pendingSave=(async()=>{const response=await fetch(base+'/receipts/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;})();return pendingSave;
 }});
 let root=createRoot(document.getElementById('root'));
 const enter=async()=>{await act(async()=>root.render(React.createElement(App)));await act(async()=>[...document.querySelectorAll('nav button')].find(button=>button.textContent==='Banking').click());await act(async()=>{await pendingHistory;});};
 await enter();
 const form=()=>document.querySelector('.banking-form');
 const change=async(name,value)=>{const input=form().elements.namedItem(name);await act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
 const fill=async()=>{await change('marketplace','Flipkart');await change('receivedDate','2026-10-14');await change('receivedAmount','123.45');await change('reference','SYNTHETIC-MANUAL-UTR');};
 assert.equal(form().querySelector('button').disabled,true);assert.ok(!form().parentElement.textContent.includes('Coming Soon'));assert.ok(!form().parentElement.textContent.includes('Pending reconciliation'));
 await fill();assert.equal(form().querySelector('button').disabled,false);
 await act(async()=>{form().dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form().dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pendingSave;});
 assert.equal(calls,1);assert.ok(document.body.textContent.includes('Manual bank receipt saved.'));
 assert.ok(document.querySelector('[aria-label="Bank receipt history"]').textContent.includes('SYNTHETIC-MANUAL-UTR'));
 assert.ok(document.querySelector('[aria-label="Saved receipt totals"]').textContent.includes('₹123.45'));
 assert.equal(JSON.parse(fs.readFileSync(file)).bankSettlements[0].entrySource,'Manual');
 await fill();await act(async()=>{form().dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));try{await pendingSave;}catch{}});
 assert.ok(form().textContent.includes('already recorded'));assert.equal(JSON.parse(fs.readFileSync(file)).bankSettlements.length,1);
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await enter();assert.ok(document.querySelector('[aria-label="Bank receipt history"]').textContent.includes('SYNTHETIC-MANUAL-UTR'));
 await act(async()=>root.unmount());assert.ok(originalBusiness.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))));
});

if(process.env.SELLQUANTA_VERIFY_PRIVATE_BANK_UI==='1') test('private real-file scan renders only marketplace credits, separated advisory review and exact card totals',{timeout:300000},async()=>{
 const {extractPrivatePdf}=await import('./verify-private-bank-statements.mjs');
 const {settlementDetectionResults,combineBankPreviews,bankMoney,maskBankText}=await import('../client/src/bankPreview.js');
 const files=JSON.parse(process.env.SELLQUANTA_STATEMENT_FILES||'[]');
 assert.equal(files.length,2);
 const database=fs.readFileSync(path.join(project,'data/stockpilot.json'));
 globalThis.__bankStatementInputs={}; const originalScans=[];
 for(let index=0;index<files.length;index++) {
   assert.ok(fs.existsSync(files[index]),'Private statement missing');
   const name=`private-${index}.pdf`;
   globalThis.__bankStatementInputs[name]={filename:name,pages:await extractPrivatePdf(files[index])};
 }
 globalThis.__exportApi.state=async()=>state;
 globalThis.__exportApi.health=async()=>({ollama:{ok:true}});
 globalThis.__exportApi.bankReceiptHistory=async()=>{
   const response=await fetch('http://127.0.0.1:8787/api/banking/receipts');assert.equal(response.status,200);return response.json();
 };
 let completeScan; const completed=new Promise(resolve=>{completeScan=resolve;});
 globalThis.__exportApi.bankStatementPreview=async body=>{
   const response=await fetch('http://127.0.0.1:8787/api/banking/statement/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(response.status,200);const scan=await response.json();originalScans.push(scan);if(originalScans.length===2)completeScan();return scan;
 };
 const root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(App)));
 await act(async()=>[...document.querySelectorAll('nav button')].find(button=>button.textContent==='Banking').click());
 const upload=document.querySelector('.banking-page input[type="file"]');assert.equal(upload.multiple,true);
 await act(async()=>{Object.defineProperty(upload,'files',{value:files.map((_,index)=>new dom.window.File(['private'],`private-${index}.pdf`)),configurable:true});upload.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 // Actual local Ollama is requested by the default checked control; output stays private in memory.
 if(process.env.SELLQUANTA_BANK_UI_RULES_ONLY==='1') await act(async()=>document.querySelector('.banking-scanner-controls input[type="checkbox"]').click());
 await act(async()=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='Scan Statement').click();await completed;await new Promise(resolve=>setTimeout(resolve,0));});
 const results=settlementDetectionResults(combineBankPreviews(originalScans).rows);
 const main=document.querySelector('[aria-label="Detected marketplace credits"]');
 assert.equal(main.querySelectorAll('tbody tr').length,28);assert.equal(results.confirmed.length,28);
 assert.equal(document.querySelectorAll('[aria-label="Credits needing review"] tbody tr').length,17);
 assert.deepEqual(results.summaries.map(group=>group.count),[2,3,23]);
 [...main.querySelectorAll('tbody tr')].forEach((row,index)=>{
   const actual=results.confirmed[index],cells=row.children;
   assert.ok(cells[0].firstChild.textContent===actual.date,'Real receipt date display mismatch');
   assert.ok(cells[1].querySelector('select').value===actual.marketplace,'Real receipt marketplace display mismatch');
   assert.ok(cells[2].textContent===maskBankText(actual.narration),'Real receipt narration display mismatch');
   assert.ok(cells[3].textContent===(maskBankText(actual.reference)||'—'),'Real receipt reference display mismatch');
   assert.ok(cells[4].textContent===bankMoney(actual.creditCents),'Real receipt amount display mismatch');
 });
 [...document.querySelectorAll('[aria-label="Credits needing review"] tbody tr')].forEach((row,index)=>{
   const actual=results.review[index];
   assert.ok(row.children[1].textContent===maskBankText(actual.narration),'Real ambiguous narration display mismatch');
   if(actual.ai) assert.ok(row.children[4].textContent.includes(actual.ai.marketplace),'Real Ollama suggestion display mismatch');
 });
 for(const group of results.summaries) {
   const card=document.querySelector(`[data-marketplace="${group.marketplace}"]`);
   assert.ok(card.querySelector('.stat-value').textContent===bankMoney(group.cents),'Real marketplace card amount mismatch');
   assert.ok(card.textContent.includes(`${group.count} confirmed transaction(s)`));
 }
 assert.equal(results.hiddenCount,44);
 assert.equal(main.textContent.includes('INTERNAL A-DAS'),false);
 assert.equal(originalScans.every(scan=>scan.rows.every(row=>!row.approved)),true);
 assert.equal([...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm & Save').disabled,true);
 assert.equal(document.querySelectorAll('[aria-label="Bank receipt history"] tbody tr').length,JSON.parse(database).bankSettlements.length);
 assert.ok(document.querySelector('[aria-label="Saved receipt totals"]'));
 assert.ok(database.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))),'Existing database must remain byte-identical');
 await act(async()=>root.unmount());delete globalThis.__bankStatementInputs;
});

test('permanent Banking summary survives remount, ignores history filters, refreshes saved sales and receipts on focus',async t=>{
 const {default:Banking}=await import(pathToFileURL(path.join(compiled,'Banking.mjs')));
 const {captureFinancialSnapshot}=await import('../server/financialSnapshot.mjs');
 const databaseBefore=fs.readFileSync(path.join(project,'data/stockpilot.json'));
 let savedState={todaySales:[{id:'a',marketplace:'Amazon',date:'2024-01-01',qty:2,financialSnapshot:captureFinancialSnapshot({estimated_settlement:100},2)}],salesHistory:[],refunds:[]};
 let savedHistory={receipts:[{id:'r',marketplace:'Amazon',date:'2025-02-01',reference:'TEST-REF',amountCents:25000,displaySource:'Manual',displayStatus:'Saved'}]};
 globalThis.__exportApi.state=async()=>savedState;globalThis.__exportApi.bankReceiptHistory=async()=>savedHistory;
 let root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());assert.ok(databaseBefore.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))));});
 const render=async()=>act(async()=>root.render(React.createElement(Banking)));
 const summary=()=>document.querySelector('[aria-label="All-time marketplace settlement summary"]');
 await render();const original=summary().textContent;
 assert.ok(original.includes('₹200'));assert.ok(original.includes('₹250'));assert.ok(original.includes('₹-50'));
 assert.equal(document.querySelector('.banking-page').firstElementChild.classList.contains('banking-summary'),true);
 const month=[...document.querySelectorAll('label')].find(label=>label.firstChild.textContent==='History month').querySelector('select');
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(month,'2025-02');month.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(summary().textContent,original);
 assert.equal(document.querySelector('.banking-scan-toolbar').querySelectorAll('button').length,2);
 assert.ok(document.querySelector('.banking-scan-toolbar input[type="file"]'));
 assert.ok(document.querySelector('.banking-scan-toolbar input[type="checkbox"]'));
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();assert.equal(summary().textContent,original);
 savedState={...savedState,todaySales:[...savedState.todaySales,{id:'b',marketplace:'Amazon',qty:1,financialSnapshot:captureFinancialSnapshot({estimated_settlement:100},1)}]};
 savedHistory={receipts:[...savedHistory.receipts,{id:'next',marketplace:'Amazon',date:'2026-01-01',reference:'NEXT',amountCents:1000}]};
 await act(async()=>window.dispatchEvent(new dom.window.Event('focus')));
 assert.ok(summary().textContent.includes('₹300'));assert.ok(summary().textContent.includes('₹260'));assert.ok(summary().textContent.includes('₹40'));
});

test('Reverse modal requires reason and final confirmation, updates net totals/history immediately without real writes',async t=>{
 const {default:Banking}=await import(pathToFileURL(path.join(compiled,'Banking.mjs')));const {bankReceiptHistory}=await import('../server/bankReconciliation.mjs');const {prepareReceiptReversal}=await import('../server/bankReceiptReversal.mjs');
 let db={bankSettlements:[{id:'original',marketplace:'Amazon',date:'2026-10-15',amountCents:50000,reference:'TEST-UTR',entrySource:'Manual'}],bankingAudit:[]};let calls=0;
 globalThis.__exportApi.state=async()=>({todaySales:[]});globalThis.__exportApi.bankReceiptHistory=async()=>({receipts:bankReceiptHistory(db),audit:db.bankingAudit});globalThis.__exportApi.reverseBankReceipt=async(id,reason)=>{calls++;db=prepareReceiptReversal(db,{receiptId:id,reason,confirmed:true}).db;return {history:{receipts:bankReceiptHistory(db),audit:db.bankingAudit}};};
 const before=fs.readFileSync(path.join(project,'data/stockpilot.json')),root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.ok(before.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))));});await act(async()=>root.render(React.createElement(Banking)));
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 await act(async()=>button('Reverse').click());const modal=document.querySelector('[role="dialog"]');assert.ok(modal.textContent.includes('TEST-UTR'));assert.ok(modal.textContent.includes('original'));assert.equal(button('Confirm Reversal').disabled,true);
 await act(async()=>{const select=modal.querySelector('select');Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(select,'Wrong amount');select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.equal(button('Confirm Reversal').disabled,true);
 await act(async()=>modal.querySelector('input[type="checkbox"]').click());assert.equal(button('Confirm Reversal').disabled,false);await act(async()=>button('Confirm Reversal').click());assert.equal(calls,1);assert.equal(button('Reverse'),undefined);
 const table=document.querySelector('[aria-label="Bank receipt history"]');assert.ok(table.textContent.includes('Reversed'));assert.ok(table.textContent.includes('Reversal'));assert.ok(table.textContent.includes('Wrong amount'));assert.ok(document.querySelector('[aria-label="All-time marketplace settlement summary"]').textContent.includes('₹0.00'));
});
