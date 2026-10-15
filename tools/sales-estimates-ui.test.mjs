import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/dashboard-estimates-components-'));
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
const figure=label=>[...document.querySelectorAll('.dashboard-overview .fig-cell')].find(el=>el.querySelector('.fig-l')?.textContent===label);
test('Dashboard displays Invoice Amount, captured/inferred estimates, company/market breakdowns and missing data under the selected month',async t=>{
 const {captureFinancialSnapshot}=await import('../server/financialSnapshot.mjs');
 const mapping={id:'m',companyId:'c',marketplace:'Amazon',marketplaceSku:'SKU',productId:'p',estimated_settlement:140,estimated_profit:20};
 const base={companyId:'c',agentId:'a',marketplace:'Amazon',marketplaceSku:'SKU',productId:'p',costTotal:10};
 const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',name:'Agent',companyId:'c'}],products:[{id:'p',sku:'PDN',name:'Product',stock:100}],ledger:[],productMaster:[mapping],refunds:[],accounts:[],salesHistory:[{...base,id:'old',orderId:'old',date:'2026-01-10',qty:1,saleAmount:50}],todaySales:[{...base,id:'new',orderId:'new',date:'2026-01-12',qty:2,saleAmount:100,financialSnapshot:captureFinancialSnapshot({...mapping,estimated_settlement:120,estimated_profit:15},2)},{...base,id:'missing',date:'2026-02-12',qty:1,saleAmount:25,financialSnapshot:captureFinancialSnapshot(null,1)}]};
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(Dashboard,{state})));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
await change(document.getElementById('dash-month'),'2026-01');
  assert.match(figure('Total Invoice Amount').textContent,/150/);assert.match(figure('Total Estimated Settlement').textContent,/380/);assert.match(figure('Total Estimated Profit').textContent,/50/);
 assert.match(figure('Total Estimated Profit').textContent,/2 units: captured at sale time/);assert.match(figure('Total Estimated Profit').textContent,/1 units: inferred from current mappings/);
 assert.ok(figure('Monthly Orders'));assert.ok(figure('Monthly Quantity'));assert.ok(document.body.textContent.includes('Low Stock'));assert.ok(document.body.textContent.includes('Top Selling Products'));
 const company=[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Company Performance'));assert.ok(company.textContent.includes('Estimated Settlement'));assert.ok(company.textContent.includes('Estimated Profit'));assert.ok(company.textContent.includes('Amazon'));assert.ok(company.textContent.includes('Flipkart'));assert.ok(company.textContent.includes('Meesho'));
 assert.ok(company.parentElement.classList.contains('company-performance'));assert.equal(company.querySelectorAll('th').length,7);assert.equal(company.querySelectorAll('td.n small').length,0);assert.ok(company.querySelector('[title*="inferred from current mappings"]'));
 const rows=[...company.querySelectorAll('tbody tr')];assert.equal(rows.length,4);assert.equal(rows[0].className,'group');assert.deepEqual(rows.slice(1).map(r=>r.querySelector('.mkt').textContent),['Amazon','Flipkart','Meesho']);
 for(const index of [1,2])assert.equal(Number(rows[0].children[index].textContent),rows.slice(1).reduce((sum,r)=>sum+Number(r.children[index].textContent),0));
 const css=fs.readFileSync(path.join(project,'client/src/styles.css'),'utf8');assert.match(css,/\.dgrid\.company-performance \{ grid-template-columns: minmax\(0, 1fr\); \}/);
 await change(document.getElementById('dash-month'),'2026-02');assert.match(figure('Total Invoice Amount').textContent,/25/);assert.match(figure('Total Estimated Profit').textContent,/Not available/);assert.match(figure('Total Estimated Settlement').textContent,/missing mapping\/value/);
 await act(async()=>root.render(React.createElement(Dashboard,{state:{...state,companies:[...state.companies,{id:'new',name:'New Company'}]}})));assert.equal(document.querySelectorAll('.company-performance tbody tr').length,8);assert.ok(document.querySelector('.company-performance').textContent.includes('New Company'));

});
