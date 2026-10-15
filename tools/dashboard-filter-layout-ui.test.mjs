import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/dashboard-filter-layout-components-'));
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


const click=async(el)=>{await act(async()=>el.click());};
const change=async(el,value)=>{await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
test('Month / Date Range repeated switches retain the existing controls, selection and calculations within one stable header',async t=>{
 const state={companies:[],agents:[],products:[],ledger:[],accounts:[],productMaster:[],refunds:[],salesHistory:[],todaySales:[{id:'s',date:'2026-01-15',qty:2,saleAmount:100,orderId:'s',costTotal:20,marketplace:'Amazon'}]};
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(Dashboard,{state})));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await change(document.getElementById('dash-month'),'2026-01');
 const header=document.querySelector('.dashboard-period-header'),summary=document.querySelector('.dashboard-overview .figs');
 const mode=text=>[...header.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()===text);
 for(let i=0;i<5;i++){
  await click(mode('Date Range'));assert.equal(document.querySelector('.dashboard-period-header'),header);assert.equal(document.querySelector('.dashboard-overview .figs'),summary);
  assert.equal(document.getElementById('dash-from').value,'2026-01-01');assert.equal(document.getElementById('dash-to').value,'2026-01-31');assert.equal(header.querySelectorAll('.acts').length,1);assert.ok(!document.getElementById('dash-month'));
  await change(document.getElementById('dash-from'),'2026-01-16');assert.match(summary.querySelector('.fig-v').textContent,/0/);
  await click(mode('Month'));assert.equal(document.getElementById('dash-month').value,'2026-01');assert.match(summary.querySelector('.fig-v').textContent,/100/);assert.equal(document.querySelector('.dashboard-period-header'),header);
 }
 const css=fs.readFileSync(path.join(project,'client/src/styles.css'),'utf8');
 assert.match(css,/\.dashboard-period-header \{ height: 80px;/);assert.match(css,/\.dashboard-period-header > \.acts \{[^}]*width: 488px;[^}]*flex-wrap: nowrap/);
 assert.match(css,/@container \(max-width: 700px\)/);assert.match(css,/@media \(max-width: 760px\)/);
 assert.match(css,/\.dashboard-filter-fields \{[^}]*height: 32px/);
 assert.equal((css.match(/grid-template-rows: 20px 36px 90px/g)||[]).length,2);
 assert.equal((css.match(/grid-template-rows: 32px 54px/g)||[]).length,2);
 assert.ok(header.querySelector('.dashboard-filter-fields'));
});

test('Overall Business Summary reconciles saved all-time records independently of monthly and date filters',async t=>{
 const {sample}=await import('./fixtures/master-chart.mjs');
 const state=sample();
 state.salesHistory.push({...state.salesHistory[0],id:'oct',orderId:'OCT',date:'2026-10-10',qty:1,saleAmount:100,costTotal:40});
 state.todaySales.push({...state.salesHistory[0]});
 state.returnCharges.push({...state.returnCharges[0],id:'duplicate-fee'});
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await act(async()=>root.render(React.createElement(Dashboard,{state})));
 const overall=document.querySelector('.dashboard-overall'),monthly=document.querySelector('.dashboard-overview');
 assert.equal(overall.nextElementSibling,monthly);
 assert.equal(overall.querySelector('h3').textContent,'Overall Business Summary');
 assert.equal(overall.querySelector('.meta').textContent,'All-time business performance');
 assert.equal(overall.querySelector('select,input,button'),null);
 const labels=[...overall.querySelectorAll('.fig-l')].map(e=>e.textContent);
 assert.deepEqual(labels,['Total Invoice Amount','Total Orders','Net Quantity','Total Product Cost','Total Estimated Settlement','Total Estimated Profit','Total Refund Amount','Total Purchase']);
 const values=()=>[...overall.querySelectorAll('.fig-v')].map(e=>e.textContent);
 const amounts=()=>values().map(s=>Number(s.replace(/[^0-9.-]/g,'')));
 assert.deepEqual(amounts(),[700,2,7,280,560,86.9,400,100]);
 const snapshot=overall.textContent;
 await change(document.getElementById('dash-month'),'2026-09');
 const september=monthly.querySelector('.fig-v').textContent;
 await change(document.getElementById('dash-month'),'2026-10');
 assert.notEqual(monthly.querySelector('.fig-v').textContent,september);assert.equal(overall.textContent,snapshot);
 await click([...document.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()==='Date Range'));
 await change(document.getElementById('dash-from'),'2026-09-12');await change(document.getElementById('dash-to'),'2026-09-12');
 assert.equal(overall.textContent,snapshot);
 assert.equal(document.querySelectorAll('.dashboard-low-stock').length,1);
 assert.equal(document.getElementById('root').lastElementChild.classList.contains('product-return-analysis'),true);
 const missing=structuredClone(state);delete missing.salesHistory[1].financialSnapshot;delete missing.salesHistory[1].costTotal;
 await act(async()=>root.render(React.createElement(Dashboard,{state:missing})));
 const cells=[...document.querySelectorAll('.dashboard-overall .fig-v')];
 for(const i of [3,4,5])assert.equal(cells[i].textContent,'Not available');
});

test('monthly purchase KPI follows saved Purchase Date and inclusive range; Overall and seven financial KPIs stay unchanged',async t=>{
 const {sample}=await import('./fixtures/master-chart.mjs');
 const state=sample();
 state.salesHistory.push({...state.salesHistory[0],id:'oct',date:'2026-10-10',orderId:'OCT'});
 state.purchases=[{id:'first',date:'2026-09-01',totalCents:50000,quantity:20},
  {id:'last',date:'2026-09-30',amountCents:100000,quantity:30},
  {id:'first',date:'2026-09-01',totalCents:50000,quantity:20}];
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 const render=async data=>act(async()=>root.render(React.createElement(Dashboard,{state:data})));
 await render(state);
 const figures=selector=>[...document.querySelectorAll(selector+' .fig-v')].map(el=>el.textContent);
 const monthly=()=>figures('.dashboard-overview'),overall=()=>figures('.dashboard-overall');
 const numeric=text=>Number(text.replace(/[^0-9.-]/g,''));
 const overallSnapshot=overall();assert.equal(numeric(overallSnapshot[7]),1500);
 for(const [month,total]of [['2026-10',0],['2026-09',1500],['2026-10',0]]){
  await change(document.getElementById('dash-month'),month);
  assert.equal(numeric(monthly()[7]),total);assert.deepEqual(overall(),overallSnapshot);
  const seven=monthly().slice(0,7);
  await render({...state,purchases:[]});assert.deepEqual(monthly().slice(0,7),seven);
  await render(state);
 }
 await click([...document.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()==='Date Range'));
 for(const [from,to,total]of [['2026-09-01','2026-09-30',1500],['2026-09-01','2026-09-01',500],['2026-09-30','2026-09-30',1000],['2026-09-02','2026-09-29',0]]){
  await change(document.getElementById('dash-from'),from);await change(document.getElementById('dash-to'),to);
  assert.equal(numeric(monthly()[7]),total);assert.deepEqual(overall(),overallSnapshot);
 }
});
