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
const compiled=mkdtempSync(join(project,'tmp','sales-history-components-'));
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
test('Daily Sales date picker defaults to today, filters archived history, returns Today, preserves columns and safely dispatches Undo',async t=>{
 const today=localToday(),yesterday='2000-01-01';
 const sale=(id,date,batchId)=>({id,date,createdAt:date+'T12:00:00',batchId,productId:'p',agentId:'a',accountId:'ac',orderId:id,qty:1,saleAmount:10,source:'manual'});
 const state={companies:[{id:'c',name:'C'}],agents:[{id:'a',companyId:'c',name:'A'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon',name:'Amazon'}],products:[{id:'p',sku:'PDN',name:'P',stock:10}],productMaster:[],todaySales:[sale('today1',today,'latest'),sale('today2',today,'latest')],salesHistory:[sale('old',yesterday,'archived')],refunds:[],ledger:[],stockMovements:[]};
 const before=structuredClone(state),calls=[],messages=[];window.confirm=()=>true;
 Object.assign(globalThis.__salesTest.api,{state:async()=>state,undoLastBatch:async(...args)=>{calls.push(args);return {undone:2};}});
 const root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(Sales,{state,reload:async()=>{},notify:m=>messages.push(m),setHealth:()=>{}})));
 t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 const picker=document.getElementById('sales-history-date'),card=picker.closest('.card'),button=text=>[...card.querySelectorAll('button')].find(b=>b.textContent===text),click=async el=>await act(async()=>el.click());
 assert.equal(picker.value,today);assert.equal(card.querySelectorAll('tbody tr').length,2);assert.deepEqual([...card.querySelectorAll('th')].map(t=>t.textContent),['Agent','Account','Order','Product','Qty','Amount','Cost','Estimated Settlement','Estimated Profit','Source']);assert.equal(button('Undo Last Batch').disabled,false);
 await change(picker,yesterday);assert.match(card.textContent,/1 sale/);assert.match(card.querySelector('tbody').textContent,/old/);assert.ok(button('Undo Last Batch').disabled);assert.match(card.textContent,/latest batch.*selected date/);
 await change(picker,'2000-01-02');assert.match(card.textContent,/No sales recorded for this date/);await change(picker,'2099-12-31');assert.match(card.textContent,/0 sales/);
 await click(button('Today'));assert.equal(picker.value,today);assert.equal(card.querySelectorAll('tbody tr').length,2);
 await click(button('Undo Last Batch'));assert.deepEqual(calls,[['latest',today]]);
 globalThis.__salesTest.api.state=async()=>({...state,todaySales:[...state.todaySales,sale('concurrent','2099-12-31','changed')]});await click(button('Undo Last Batch'));assert.equal(calls.length,1);assert.ok(messages.some(m=>/selected date|changed/.test(m)));
 const empty={...state,todaySales:[]};await act(async()=>root.render(React.createElement(Sales,{state:empty,reload:async()=>{},notify:()=>{},setHealth:()=>{}})));assert.match(card.textContent,/No sales recorded for this date/);
});

test('Manual Sale account labels and saved sale Account cells show only marketplace while preserving IDs and Agent',async t=>{
 const today=localToday();const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',companyId:'c',name:'alshiba'}],accounts:['Amazon','Flipkart','Meesho'].map((marketplace,i)=>({id:'account-'+i,agentId:'a',marketplace,name:'alshiba - '+marketplace})),products:[],productMaster:[],refunds:[],ledger:[],stockMovements:[],todaySales:[{id:'s1',date:today,agentId:'a',accountId:'account-0',qty:1,saleAmount:10,marketplace:'Amazon'},{id:'s2',date:today,agentId:'a',accountId:'account-1',qty:1,saleAmount:20}],salesHistory:[]};
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await act(async()=>root.render(React.createElement(Sales,{state,reload:async()=>{},notify:()=>{},setHealth:()=>{}})));
 const manual=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Manual Sale'));if(manual)await act(async()=>manual.click());
 const account=[...document.querySelectorAll('label')].find(label=>label.firstChild.textContent==='Account').querySelector('select');
 assert.deepEqual([...account.options].slice(1).map(o=>[o.value,o.textContent]),[['account-0','Amazon'],['account-1','Flipkart'],['account-2','Meesho']]);
 const rows=[...document.querySelectorAll('.today-sales-table tbody tr')];assert.deepEqual(rows.map(row=>row.children[1].textContent).sort(),['Amazon','Flipkart']);assert.ok(rows.every(row=>row.children[0].textContent==='alshiba'));assert.ok(!rows.some(row=>row.children[1].textContent.includes('alshiba')));
});

test('Manual Sale Date defaults locally, validates dates, saves selection and resets after success',async t=>{
 const state={companies:[{id:'c',name:'C'}],agents:[{id:'a',companyId:'c',name:'A'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon'}],products:[{id:'p',sku:'PDN',name:'P',stock:10}],productMaster:[],refunds:[],ledger:[],stockMovements:[],todaySales:[],salesHistory:[]};
 const before=structuredClone(state),calls=[],messages=[];
 Object.assign(globalThis.__salesTest.api,{addSales:async rows=>{calls.push(rows);return rows;}});
 const root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(Sales,{state,reload:async()=>{},notify:m=>messages.push(m),setHealth:()=>{}})));
 t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 const picker=document.querySelector('[aria-label="Sale Date"]'),save=[...document.querySelectorAll('.manual button')].find(b=>b.textContent==='Add Sale');
 assert.equal(picker.value,localToday());assert.equal(picker.max,localToday());assert.equal(picker.required,true);
 await act(async()=>save.click());assert.equal(calls[0][0].saleDate,localToday());
 await change(picker,'2000-02-29');await act(async()=>save.click());assert.equal(calls[1][0].saleDate,'2000-02-29');assert.equal(calls[1][0].source,'manual');assert.equal(picker.value,localToday());
 for(const date of ['','2099-01-01']){await change(picker,date);await act(async()=>save.click());}
 assert.equal(calls.length,2);assert.ok(messages.some(m=>/future/.test(m)));assert.ok(messages.some(m=>/valid Sale Date/.test(m)));
 globalThis.__salesTest.api.addSales=async()=>{throw Error('Save unavailable');};
 await change(picker,'2000-01-01');await act(async()=>save.click());assert.equal(picker.value,'2000-01-01');
});
