import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/dashboard-bank-components-'));
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


const change=async(el,value)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
const waitFor=async(predicate)=>{for(let i=0;i<100;i++){await act(async()=>new Promise(r=>setTimeout(r,20)));if(predicate())return;}assert(predicate(),'Timed out waiting for UI: '+document.body.textContent.slice(-1600));};
test('Dashboard changes only the two requested KPI cards, adding only the purchase total in the eighth space and existing four-column CSS',async t=>{
 const {captureFinancialSnapshot}=await import('../server/financialSnapshot.mjs');
 const mapping={id:'m',companyId:'c',marketplace:'Amazon',marketplaceSku:'SKU',productId:'p',estimated_settlement:100,estimated_profit:20};
 const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',companyId:'c'}],products:[{id:'p',sku:'PDN',name:'Product',stock:10},{id:'out',sku:'OUT',name:'Out product',stock:0,lowStockLevel:5},{id:'edge',sku:'EDGE',name:'Threshold product',stock:5,lowStockLevel:5},{id:'above',sku:'ABOVE',name:'Above threshold',stock:6,lowStockLevel:5},{id:'archived',sku:'ARCHIVED',name:'Archived product',stock:0,active:false}],ledger:[],accounts:[],productMaster:[mapping],refunds:[],salesHistory:[],todaySales:[{id:'s',companyId:'c',agentId:'a',marketplace:'Amazon',productId:'p',date:'2026-01-15',qty:3,saleAmount:450,costTotal:60,financialSnapshot:captureFinancialSnapshot(mapping,3)}],bankSettlements:[{id:'r',marketplace:'Amazon',date:'2026-01-25',amountCents:15000},{id:'prior',marketplace:'Flipkart',date:'2025-12-20',amountCents:2500}]};
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(Dashboard,{state})));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await change(document.getElementById('dash-month'),'2026-01');
 const labels=[...document.querySelectorAll('.dashboard-overview .figs > .fig-cell .fig-l')].map(el=>el.textContent);
 assert.deepEqual(labels,['Total Invoice Amount','Monthly Orders','Monthly Quantity','Total Product Cost','Total Estimated Settlement','Total Estimated Profit','Total Refund Amount','Total Purchase']);
 const cells=[...document.querySelectorAll('.dashboard-overview .figs > .fig-cell')];assert.equal(cells.length,8);assert.equal(cells[3].querySelector('.fig-v').textContent,'₹60');assert.equal(cells[6].querySelector('.fig-v').textContent,'₹0');assert.equal(cells[6].querySelector('.fig-s'),null);
 assert.ok(!document.querySelector('.dashboard-overview .figs').textContent.includes('Monthly Profit'));
 for(const label of ['Low Stock','Company Performance','Top Selling Products','Top Performing Accounts','Agent Activity'])assert.ok(document.body.textContent.includes(label));
 assert.ok(!document.body.textContent.includes('Today Summary'));
 assert.ok(!document.body.textContent.includes('Marketplace Banking & Settlement'));
 assert.equal(document.querySelector('.dashboard-marketplace-banking'),null);
 assert.ok(document.querySelector('.dash-top').nextElementSibling.classList.contains('company-performance'));
 const topCards=[document.querySelector('.dashboard-overview'),document.querySelector('.dashboard-low-stock')];assert.equal(topCards.length,2);assert.equal(topCards[1].querySelector('h3').textContent,'Low Stock');assert.equal(document.querySelectorAll('.dashboard-low-stock').length,1);assert.equal(document.querySelector('.dgrid .dashboard-low-stock'),null);assert.match(topCards[1].textContent,/2 at \/ below alert level/);assert.match(topCards[1].textContent,/Out product/);assert.match(topCards[1].textContent,/Threshold product/);assert.ok(!topCards[1].textContent.includes('Above threshold'));assert.ok(!topCards[1].textContent.includes('Archived product'));assert.deepEqual([...topCards[1].querySelectorAll('.badge')].slice(1).map(b=>b.textContent),['Out','Low']);
 const css=fs.readFileSync(path.join(project,'client/src/styles.css'),'utf8');assert.match(css,/\.figs \{ display: grid; grid-template-columns: 1\.35fr 1fr 1fr 1fr; \}/);
});

test('cost and refund cards respond to month, date range and newly supplied sales without changing refund count',async t=>{
  const sale={id:'s',date:'2026-09-10',qty:3,saleAmount:300,costTotal:60,marketplace:'Amazon'};
  const refund={id:'r',saleId:'s',refundDate:'2026-09-15',qty:1,refundAmount:100};
  const state={companies:[],agents:[],products:[],ledger:[],accounts:[],productMaster:[],salesHistory:[],todaySales:[sale,{id:'oct',date:'2026-10-01',qty:1,saleAmount:80,costTotal:25}],refunds:[refund,{...refund},{id:'oct-r',saleId:'s',refundDate:'2026-10-02',qty:1,refundAmount:75}]};
  const before=structuredClone(state),root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Dashboard,{state})));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
  const value=label=>[...document.querySelectorAll('.dashboard-overview .fig-cell')].find(c=>c.querySelector('.fig-l').textContent===label).querySelector('.fig-v').textContent;
  const check=(cost,refund)=>{assert.equal(value('Total Product Cost'),cost);assert.equal(value('Total Refund Amount'),refund);};
  await change(document.getElementById('dash-month'),'2026-09');check('₹40','₹100');
  assert.match([...document.querySelectorAll('.dashboard-overview .fig-cell')][1].textContent,/1 refund this month/);
  await change(document.getElementById('dash-month'),'2026-10');check('₹5','₹75');
  await act(async()=>[...document.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()==='Date Range').click());
  const date=async(id,v)=>act(async()=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await date('dash-from','2026-09-10');await date('dash-to','2026-09-15');check('₹40','₹100');
  await date('dash-from','2026-09-15');check('-₹20','₹100');
  const updated={...state,todaySales:[...state.todaySales,{id:'new',date:'2026-09-15',qty:2,costTotal:40,saleAmount:90}]};
  await act(async()=>root.render(React.createElement(Dashboard,{state:updated})));
  await act(async()=>[...document.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()==='Month').click());
  await change(document.getElementById('dash-month'),'2026-09');
  await waitFor(()=>value('Total Product Cost')==='₹80');
  check('₹80','₹100');
});
