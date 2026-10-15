import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/product-return-ui-components-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__exportApi;';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{}; export const fileToImageDataUrls=()=>{};';
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
globalThis.__exportApi={};
const {Dashboard}=await import(pathToFileURL(path.join(compiled,'App.mjs')));

test('₹53.10 charge-only September is selectable and displays in summary and bottle row, not October',async t=>{
  const state={companies:[],agents:[],products:[{id:'bottle',name:'400ml Glass Inner Water Bottle',sku:'W1'}],ledger:[],accounts:[],productMaster:[],purchases:[],refunds:[],todaySales:[],
    salesHistory:[{id:'sale',date:'2026-10-14',productId:'bottle',marketplace:'Amazon',marketplaceSku:'PGG140005',qty:1,costTotal:80,saleAmount:160,orderId:'406-4079649-7363539'}],
    returnCharges:[{id:'charge',status:'Confirmed',date:'2026-09-20',importedAt:'2026-10-14T21:16:32.084Z',marketplace:'Amazon',orderId:'406-4079649-7363539',sku:'PGG140005',amountCents:5310}]};
  const before=structuredClone(state),root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
  await act(async()=>root.render(React.createElement(Dashboard,{state})));
  const report=()=>document.querySelector('.product-return-analysis');
  const total=()=>[...report().querySelectorAll('.ss')].find(el=>el.textContent.includes('Total Confirmed Return Extra Charges')).querySelector('.sv').textContent;
  const select=document.getElementById('dash-month');assert.equal(select.value,'2026-10');
  assert.equal(total(),'₹0.00');assert.equal(report().querySelector('[role="status"]'),null);
  assert.equal(report().querySelectorAll('.ss').length,5);
  assert.equal(report().querySelector('.note'),null);
  assert.doesNotMatch(report().textContent,/View September 2026 charges|Updates the Dashboard period|Uses the Dashboard period|Separate quantities|outside the selected period/);
  assert.ok([...select.options].some(o=>o.value==='2026-09'));
  assert.equal(report().querySelectorAll('button').length,0);
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(select,'2026-09');select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(select.value,'2026-09');
  assert.equal(total(),'₹53.10');
  const row=report().querySelector('table[aria-label="Product return report"] tbody tr');
  assert.match(row.textContent,/400ml Glass Inner Water Bottle/);assert.equal(row.children[6].textContent,'₹53.10');
  assert.equal(report().querySelector('[role="status"]'),null);
});

test('Dashboard report renders seven columns, separate classifications and follows marketplace / shared period controls',async t=>{
  const state={companies:[],agents:[],products:[{id:'p',name:'Bottle',sku:'W1'}],ledger:[],accounts:[],productMaster:[],purchases:[],
    salesHistory:[{id:'s',date:'2026-09-10',productId:'p',marketplace:'Amazon',qty:8,costTotal:80,saleAmount:160,orderId:'o'},
      {id:'f',date:'2026-10-10',productId:'p',marketplace:'Flipkart',qty:5,costTotal:50,saleAmount:100}],
    refunds:[{id:'r',saleId:'s',productId:'p',marketplace:'Amazon',refundDate:'2026-09-12',qty:1,refundAmount:20,refundReason:'Customer Return'},
      {id:'rto',saleId:'s',productId:'p',marketplace:'Amazon',refundDate:'2026-09-12',qty:1,refundAmount:20,refundReason:'RTO'}],todaySales:[],returnCharges:[]};
  const original=structuredClone(state),root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,original);});
  await act(async()=>root.render(React.createElement(Dashboard,{state})));
  const change=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const report=()=>document.querySelector('.product-return-analysis');
  const table=()=>report().querySelector('table[aria-label="Product return report"]');
  await change(document.getElementById('dash-month'),'2026-09');
  assert.equal(table().querySelectorAll('thead th').length,7);
  assert.match(table().textContent,/Bottle/);assert.match(table().textContent,/12\.50%/);
  assert.match(report().textContent,/RTO: 1/);assert.match(report().textContent,/Cancelled: 0/);
  await change(report().querySelector('select'),'Flipkart');assert.match(table().textContent,/No sales, refunds/);
  await change(report().querySelector('select'),'All');
  await change(document.getElementById('dash-month'),'2026-10');assert.match(table().textContent,/Flipkart/);assert.doesNotMatch(table().querySelector('tbody').textContent,/Amazon/);
  await act(async()=>[...document.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()==='Date Range').click());
  await change(document.getElementById('dash-from'),'2026-09-12');await change(document.getElementById('dash-to'),'2026-09-12');
  const cells=table().querySelector('tbody tr').children;
  assert.equal(cells[2].textContent,'0');assert.equal(cells[3].textContent,'1');assert.equal(cells[4].textContent,'—');
});


