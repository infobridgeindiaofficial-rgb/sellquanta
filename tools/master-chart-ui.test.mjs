import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/master-chart-components-'));
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
const {default:MasterChart}=await import(pathToFileURL(path.join(compiled,'MasterChart.mjs')));
import {sample} from './fixtures/master-chart.mjs';
const change=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
const click=async(el)=>{assert.ok(el,'Expected UI control');await act(async()=>el.click());};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);
const period=async()=>{await change(document.querySelector('[aria-label="Analytics reporting period"]'),'Custom Date Range');await change(document.querySelector('[aria-label="Analytics from date"]'),'2026-09-01');await change(document.querySelector('[aria-label="Analytics to date"]'),'2026-09-30');};
test('Master Chart global filters, every intelligence view, chart drill-down and pivot render without runtime errors',async t=>{
 const state=sample(),before=structuredClone(state),root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await act(async()=>root.render(React.createElement(MasterChart,{state,reload:async()=>{}})));
 await period();assert.equal(document.querySelectorAll('.mc-kpis > article').length,10);assert.match(document.querySelector('.mc-kpis').textContent,/₹66\.90/);
 for(const tab of ['Sales Intelligence','Product Intelligence','Marketplaces','Companies','Agents & Wallet','Returns & Loss','Financial Position','Analysis Builder','Business Insights']){
  await click([...document.querySelectorAll('.sidebar nav button')].find(b=>b.textContent===tab));
  assert.ok(document.querySelector('.mc-content').textContent.length>40,tab);assert.doesNotMatch(document.querySelector('.mc-content').innerHTML,/NaN|undefined|Infinity/);
 }
 await click(button('Analysis Builder'));await change(document.querySelector('[aria-label="Pivot values"]'),'returnRate');assert.match(document.querySelector('.mc-pivot-table').textContent,/20\.00%/);
 await click(button('Sales Intelligence'));
 await act(async()=>document.querySelector('.revenue-panel svg [role="button"]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));assert.ok(document.querySelector('[role="dialog"]'));assert.match(document.querySelector('[role="dialog"]').textContent,/ORDER/);
 await click(button('Back to analysis'));assert.equal(document.querySelector('[role="dialog"]'),null);
 await change(document.querySelector('[aria-label="Analytics marketplace"]'),'Meesho');assert.match(document.querySelector('.master-chart').textContent,/No transaction data/);
 await click(button('Reset Filters'));assert.equal(document.querySelector('[aria-label="Analytics marketplace"]').value,'');
});
test('cross-filtering breadcrumbs, presentation nine slides, refresh error and invalid date state',async t=>{
 const state=sample(),root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());});
 await act(async()=>root.render(React.createElement(MasterChart,{state,reload:async()=>{throw Error('Local refresh unavailable');}})));
 await period();await click(button('Marketplaces'));
 await click(document.querySelector('.donut-legend button'));
 assert.equal(document.querySelector('[aria-label="Analytics marketplace"]').value,'Amazon');assert.match(document.querySelector('.mc-breadcrumb').textContent,/Amazon/);
 await click(button('← Back'));assert.equal(document.querySelector('[aria-label="Analytics marketplace"]').value,'');
 await click(button('Present'));assert.ok(document.querySelector('.mc-presenting'));
 for(let i=0;i<8;i++)await click(button('Next →'));
 assert.match(document.querySelector('.mc-slide-controls').textContent,/9 \/ 9/);assert.ok(document.querySelector('.slide-canvas .insight-cards'));
 await click(button('Exit Presentation'));assert.equal(document.querySelector('.mc-presenting'),null);assert.equal(document.querySelector('[aria-label="Analytics from date"]').value,'2026-09-01');
 await click(button('Refresh data'));assert.match(document.querySelector('[role="alert"]').textContent,/Local refresh unavailable/);
 await change(document.querySelector('[aria-label="Analytics from date"]'),'2026-10-02');assert.match(document.querySelector('.master-chart').textContent,/valid date range/);
});
test('App sidebar opens new workspace without replacing Dashboard',async t=>{
 const state=sample(),root=createRoot(document.getElementById('root'));
 globalThis.__exportApi={state:async()=>state,health:async()=>({ollama:{ok:false}})};
 const {default:App}=await import(pathToFileURL(path.join(compiled,'App.mjs')));
 t.after(async()=>{await act(async()=>root.unmount());});
 await act(async()=>root.render(React.createElement(App)));
 assert.ok(document.querySelector('.dashboard-overview'));await click([...document.querySelectorAll('aside nav button')].find(b=>b.textContent==='Master Chart'));
 assert.ok(document.querySelector('.master-chart'));await click(button('Back to SellQuanta'));assert.ok(document.querySelector('.dashboard-overview'));
});
test('all chart types render accessible real-value SVG geometry; absent values remain unavailable',async()=>{
 const {default:Visual}=await import(pathToFileURL(path.join(compiled,'masterChartCharts.mjs')));
 const {renderToStaticMarkup}=await import('../client/node_modules/react-dom/server.node.js');
 for(const type of ['line','area','bar','stacked','donut','heatmap','treemap','waterfall','scatter','comparison']){
  const html=renderToStaticMarkup(React.createElement(Visual,{type,title:type,metric:'revenue',data:[{label:'Bottle',value:10000,second:2000,y:20,start:0,end:10000},{label:'Cup',value:5000,second:1000,y:5,start:10000,end:15000}],onSelect:()=>{}}));
  assert.match(html,/role="img"/);assert.match(html,/Bottle/);assert.doesNotMatch(html,/NaN|Infinity|undefined/);
 }
 for(const type of ['donut','scatter','treemap'])assert.match(renderToStaticMarkup(React.createElement(Visual,{title:type,type,data:[{label:'Missing',value:0,y:null}]})),/Insufficient data/);
});
test('approved Hybrid layout, matrix, chart modes, nested investigation and two-level pivot use saved data',async t=>{
 const state=sample(),before=structuredClone(state),root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await act(async()=>root.render(React.createElement(MasterChart,{state,reload:async()=>{}})));
 await period();assert.equal(document.querySelectorAll('.canvas-top>.panel,.canvas-middle>.panel,.canvas-bottom>.panel').length,9);
 assert.equal(document.querySelectorAll('.product-matrix thead th').length,10);assert.equal(document.querySelectorAll('.kpi').length,10);assert.equal(document.querySelectorAll('.hybrid-secondary-kpis>span').length,4);
 assert.doesNotMatch(document.querySelector('.hybrid-live').textContent,/DEMO|fictional|Glassworks|Homecraft|Arjun/);
 assert.equal(document.querySelector('[data-metric="extra"] .kpi-value').textContent,'₹53.10');
 for(const mode of ['Area','Bars','Combined']){await change(document.querySelector('[aria-label="Revenue chart type"]'),mode);assert.equal(document.querySelectorAll('.revenue-panel .revenue-plot polyline').length,mode==='Area'?2:mode==='Bars'?0:1);}
 await change(document.querySelector('[aria-label="Search product matrix"]'),'missing-product');assert.match(document.querySelector('.product-matrix tbody').textContent,/No matching saved/);
 await change(document.querySelector('[aria-label="Search product matrix"]'),'WH-P');
 assert.equal(document.querySelector('.product-matrix tfoot td:last-child').textContent,'10');
 await click(document.querySelector('.product-name'));assert.ok(document.querySelector('.investigation-drawer'));assert.match(document.querySelector('.drawer-records').textContent,/ORDER/);
 await click(document.querySelector('.drawer-records .hybrid-record-button'));assert.ok(document.querySelector('[aria-label="Back in investigation"]'));
 await click(document.querySelector('[aria-label="Back in investigation"]'));await click(button('Filter workspace to this selection'));
 assert.equal(document.querySelector('[aria-label="Analytics Product / SKU"]').value,'p');assert.equal(document.querySelector('.investigation-drawer'),null);
 await click(button('Clear selections'));assert.equal(document.querySelector('[aria-label="Analytics from date"]').value,'2026-09-01');
 await click(button('Analysis Builder'));await change(document.querySelector('[aria-label="Pivot second row"]'),'marketplace');
 await change(document.querySelector('[aria-label="Pivot values"]'),'returnRate');assert.match(document.querySelector('.pivot-matrix tfoot').textContent,/20\.00%/);
 const toggle=document.querySelector('.hybrid-pivot-subtotal button');assert.equal(toggle.getAttribute('aria-expanded'),'true');await click(toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');
});
test('Hybrid export control sends current filters and pivot to the existing real Excel endpoint once',async t=>{
 const state=sample(),root=createRoot(document.getElementById('root')),priorFetch=globalThis.fetch,priorClick=dom.window.HTMLAnchorElement.prototype.click;
 const requests=[],downloads=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,blob:async()=>new Blob(['workbook'])};};
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
 t.after(async()=>{await act(async()=>root.unmount());globalThis.fetch=priorFetch;dom.window.HTMLAnchorElement.prototype.click=priorClick;});
 await act(async()=>root.render(React.createElement(MasterChart,{state,reload:async()=>{}})));await period();
 await change(document.querySelector('[aria-label="Analytics marketplace"]'),'Amazon');await click(button('Analysis Builder'));
 await change(document.querySelector('[aria-label="Pivot values"]'),'returnRate');
 await act(async()=>{document.querySelector('.header-actions .lime-button').click();document.querySelector('.header-actions .lime-button').click();});
 assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:8787/api/master-chart/export');
 assert.equal(requests[0].body.filters.marketplace,'Amazon');assert.equal(requests[0].body.filters.from,'2026-09-01');assert.equal(requests[0].body.pivot.metric,'returnRate');assert.match(downloads[0],/\.xlsx$/);
});
test('Hybrid charts keep missing estimates unavailable and negative financial geometry valid',async()=>{
 const {RevenueChart,Waterfall,Treemap,Donut}=await import(pathToFileURL(path.join(compiled,'masterChartHybridCharts.mjs')));
 const {buildMasterChart}=await import('../client/src/masterChartData.js');
 const {renderToStaticMarkup}=await import('../client/node_modules/react-dom/server.node.js');
 const state=sample();delete state.salesHistory[0].financialSnapshot;
 let r=buildMasterChart(state,{from:'2026-09-01',to:'2026-09-30'});
 for(const View of [Waterfall,Treemap])assert.match(renderToStaticMarkup(React.createElement(View,{rows:r.facts})),/Not Available/);
 const refundOnly=r.facts.filter(f=>f.kind==='Refund');
 for(const mode of ['Combined','Area','Bars']){
  const html=renderToStaticMarkup(React.createElement(RevenueChart,{rows:refundOnly,mode}));assert.doesNotMatch(html,/NaN|Infinity|undefined/);
  const doc=new JSDOM(html).window.document;for(const rect of doc.querySelectorAll('rect[height]'))assert.ok(Number(rect.getAttribute('height'))>=0);
 }
 assert.match(renderToStaticMarkup(React.createElement(Donut,{rows:refundOnly})),/Not Available/);
 assert.match(renderToStaticMarkup(React.createElement(RevenueChart,{rows:[]})),/No saved records/);
});



test('compact SellQuanta shell and every repeated sidebar click scroll to analytical content',async t=>{
 const root=createRoot(document.getElementById('root')),calls=[];
 const original=dom.window.HTMLElement.prototype.scrollIntoView;
 const media=window.matchMedia;
 dom.window.HTMLElement.prototype.scrollIntoView=function(options){calls.push({element:this,options});};
 let reduced=false;window.matchMedia=()=>({matches:reduced});
 t.after(async()=>{await act(async()=>root.unmount());dom.window.HTMLElement.prototype.scrollIntoView=original;window.matchMedia=media;});
 await act(async()=>root.render(React.createElement(MasterChart,{state:sample()})));
 const sidebar=document.querySelector('.sidebar'),header=document.querySelector('.executive-header');
 assert.equal(sidebar.querySelector('.brand img').getAttribute('src'),'/logo.png');
 assert.equal(sidebar.querySelector('.brand img').getAttribute('width'),'26');
 assert.equal(sidebar.querySelector('.brand small').textContent,'Local Edition');
 assert.equal(sidebar.querySelectorAll('[aria-label="Back to SellQuanta"]').length,1);
 assert.equal(sidebar.querySelector('.sidebar-bottom'),null);
 assert.doesNotMatch(sidebar.textContent,/Intelligence Workspace|Business workspace|Explore every angle|Read-only local analysis|Present the story/i);
 assert.deepEqual([...header.querySelectorAll('button')].map(b=>b.textContent),['Refresh data','Present','Export Excel']);
 assert.equal(header.querySelectorAll('h1,.avatar,.eyebrow,.breadcrumbs,.data-pill').length,0);
 for(const control of [...sidebar.querySelectorAll('nav button')].filter(b=>b.textContent!=='Executive presentation')){
  for(let repeat=0;repeat<2;repeat++){
   const before=calls.length;await click(control);
   assert.equal(calls.length,before+1);
   const {element,options}=calls.at(-1);
   assert.ok(document.querySelector('.workspace').contains(element));
   assert.ok(!sidebar.contains(element));assert.equal(control.getAttribute('aria-current'),'page');
   assert.equal(options.behavior,'smooth');assert.equal(options.block,'start');
   if(control.textContent==='Business Overview')assert.match(element.textContent,/Executive command centre/);
   else {assert.equal(element,document.querySelector('.mc-content'));assert.ok(element.querySelector('h2'));assert.ok(!element.querySelector('.kpi-grid'));}
  }
 }
 reduced=true;await click(button('Business Overview'));assert.equal(calls.at(-1).options.behavior,'auto');
});
