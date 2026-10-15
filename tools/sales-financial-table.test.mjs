// Real React DOM/component tests; only PDF I/O and backend APIs are substituted.
// Test dependency: jsdom (root devDependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
console.info=()=>{};
console.debug=()=>{};

const project=resolve(import.meta.dirname,'..');
mkdirSync(join(project,'tmp'),{recursive:true});
const compiled=mkdtempSync(join(project,'tmp','sales-financial-table-components-'));
for(const file of readdirSync(join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=readFileSync(join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api = globalThis.__salesTest.api;';
  if(file==='pdf.js') code='export const fileToPdfPages = (...args)=>globalThis.__salesTest.pdf(...args); export const fileToImageDataUrls=()=>{throw Error("unexpected image fallback")};';
  if(file==='App.jsx') code+='\nexport {Sales};';
  code=code.replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name.replace(/\.(js|jsx)$/,'')}.mjs${q}`)
    .replace(/from (["'])react\1/g,`from '${pathToFileURL(join(project,'client/node_modules/react/index.js')).href}'`);
  const result=await transform(code,{loader:file.endsWith('.jsx')?'jsx':'js',format:'esm'});
  writeFileSync(join(compiled,file.replace(/\.(js|jsx)$/,'.mjs')),result.code);
}
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5173'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('../client/node_modules/react/index.js');
const {createRoot}=await import('../client/node_modules/react-dom/client.js');
const {act}=React;
globalThis.__salesTest={api:{}};
const {Sales}=await import(pathToFileURL(join(compiled,'App.mjs')));
// Mixed Amazon + Flipkart + Meesho batch through the real Daily Sales screen, using real label text layers
// (client/src/test-fixtures/labelScanLines.json). Fixture state only - no live data.

const {localToday}=await import('../client/src/salesHistoryFilter.js');
const change=async(el,value)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
const {captureFinancialSnapshot}=await import('../server/financialSnapshot.mjs');
const {salesTableFinancials,salesTableTotals}=await import('../client/src/salesTableFinancials.js');
const {salesForRange}=await import('../client/src/salesHistoryFilter.js');
const mapping={id:'m',companyId:'c',marketplace:'Amazon',productId:'p',marketplaceSku:'SKU',cost_price:12.50,estimated_settlement:80,estimated_profit:15};
const saved=(id,date,qty,source)=>({id,date,createdAt:date+'T12:00:00',agentId:'a',accountId:'ac',companyId:'c',marketplace:'Amazon',productId:'p',marketplaceSku:'SKU',productName:'Product',orderId:id,qty,saleAmount:100*qty,source,costTotal:20*qty,batchId:id,financialSnapshot:captureFinancialSnapshot(mapping,qty)});
const fixture=()=>({companies:[{id:'c',name:'Company'}],agents:[{id:'a',name:'Agent',companyId:'c'}],accounts:[{id:'ac',name:'Amazon',marketplace:'Amazon',agentId:'a'}],products:[{id:'p',sku:'PDN',name:'Product',stock:10}],productMaster:[{...mapping,cost_price:999,estimated_settlement:999,estimated_profit:999}],ledger:[],refunds:[],salesHistory:[saved('old','2026-01-01',2,'manual')],todaySales:[saved('scan','2026-01-02',3,'text-label')]});

test('saved sale snapshots respect qty, immutable historical prices, range deduplication and missing values',()=>{
 const state=fixture(),before=structuredClone(state);
 assert.deepEqual(salesTableFinancials(state.todaySales[0],state),{cost:37.5,settlement:240,profit:45});
 const rows=salesForRange({...state,todaySales:[...state.todaySales,state.salesHistory[0]]},'2026-01-01','2026-01-02');assert.equal(rows.length,2);
 assert.deepEqual(salesTableTotals(rows,state),{qty:5,amount:500,cost:62.5,settlement:400,profit:75});
 const missing={...state.todaySales[0],financialSnapshot:undefined,marketplaceSku:'MISSING',costTotal:60};assert.deepEqual(salesTableFinancials(missing,state),{cost:60,settlement:null,profit:null});
 assert.equal(salesTableTotals([missing],state).settlement,null);assert.deepEqual(state,before);
});

test('same Today Sales table has ten columns and TOTAL; range, Today and newly saved manual/scanned rows update it',async t=>{
 const state=fixture(),before=structuredClone(state),root=createRoot(document.getElementById('root'));
 const render=data=>root.render(React.createElement(Sales,{state:data,reload:async()=>{},notify:()=>{},setHealth:()=>{}}));
 await act(async()=>render(state));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 const from=document.getElementById('sales-history-date'),to=document.getElementById('sales-history-to-date'),card=from.closest('.card');
 await change(from,'2026-01-01');await change(to,'2026-01-02');
 assert.equal(card.querySelectorAll('table').length,1);assert.equal(card.querySelectorAll('thead th').length,10);assert.equal(card.querySelectorAll('tbody tr').length,2);
 assert.equal(card.querySelectorAll('.sales-total').length,1);assert.equal(card.querySelectorAll('tfoot').length,0);
 assert.equal(card.querySelector('thead tr:first-child').classList.contains('sales-total'),true);
 assert.equal(card.querySelector('thead tr:last-child th')?.textContent,'Agent');
 assert.ok(card.querySelector('.table-wrap').classList.contains('scroll'));
 const css=readFileSync(join(project,'client/src/styles.css'),'utf8');assert.match(css,/\.today-sales-table \.sales-total td \{ position: sticky; top: 0;/);assert.match(css,/\.today-sales-table thead th \{ top: 42px;/);
 const totals=()=>[...card.querySelectorAll('.sales-total td')].map(cell=>cell.textContent);
 assert.deepEqual(totals(),['TOTAL','5','₹500','₹62.5','₹400','₹75','']);
 assert.equal(card.querySelector('tbody tr').children[6].textContent,'₹37.5');assert.equal(card.querySelector('tbody tr').children[7].textContent,'₹240');assert.ok([...card.querySelectorAll('button')].find(button=>button.textContent==='Undo Last Batch').disabled);
 await change(to,'2026-01-01');assert.equal(card.querySelectorAll('tbody tr').length,1);assert.equal(totals()[1],'2');
 const added={...state,todaySales:[...state.todaySales,saved('new-manual','2026-01-01',1,'manual'),saved('new-scan','2026-01-01',2,'ollama-label')]};await act(async()=>render(added));assert.equal(card.querySelectorAll('tbody tr').length,3);assert.equal(totals()[1],'5');assert.equal(totals()[3],'₹62.5');
 await act(async()=>[...card.querySelectorAll('button')].find(button=>button.textContent==='Today').click());assert.equal(from.value,localToday());assert.equal(to.value,localToday());assert.equal(totals()[1],'0');
 await change(from,'2026-01-03');await change(to,'2026-01-01');assert.ok(card.querySelector('[role="alert"]'));assert.equal(totals()[1],'0');
});
