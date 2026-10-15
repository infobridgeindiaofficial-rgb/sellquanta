import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {sample} from './fixtures/master-chart.mjs';
import {buildMasterChart,aggregateFacts} from '../client/src/masterChartData.js';
import {totals,groups,currency,matrixGroups,waterfallSteps} from '../client/src/masterChartHybridModel.js';
const selection={from:'2026-09-01',to:'2026-09-30'};
test('Hybrid display adapters reuse exact verified cents, classification and aggregate metrics',()=>{
 const state=sample(),before=structuredClone(state),r=buildMasterChart(state,selection),t=totals(r.facts),base=aggregateFacts(r.facts);
 for(const [key,value]of Object.entries(base))assert.equal(t[key],value,key);
 assert.equal(t.qty,10);assert.equal(t.rate,20);assert.equal(currency(5310),'₹53.10');assert.equal(currency(null),'Not Available');
 for(const key of ['name','company','agent','month','marketplace']){
  const g=groups(r.facts,key);assert.equal(g.reduce((s,g)=>s+g.revenue,0),r.totals.revenue);assert.equal(g.reduce((s,g)=>s+g.extra,0),5310);
 }
 assert.deepEqual(state,before);
});
test('product matrix preserves entity IDs, shared stock, searches and unavailable dimensional ownership',()=>{
 const state=sample();state.salesHistory.push({...state.salesHistory[0],id:'s2',marketplace:'Flipkart',orderId:'OTHER'});
 let r=buildMasterChart(state,selection),matrix=matrixGroups(r);assert.equal(matrix.length,2);assert.ok(matrix.every(g=>g.currentStock===10));
 assert.equal(matrixGroups(r,'WH-P').length,2);assert.equal(matrixGroups(r,'not-found').length,0);
 r=buildMasterChart(state,{...selection,companyId:'c'});assert.ok(matrixGroups(r).every(g=>g.currentStock===null));
 state.products.push({id:'q',name:'Bottle',sku:'OTHER',stock:4,costPrice:40});state.salesHistory.push({...state.salesHistory[0],id:'s3',productId:'q'});
 r=buildMasterChart(state,selection);assert.equal(groups(r.facts,'name').filter(g=>g.records.some(f=>f.productId)).length,2);assert.ok(r.review.some(f=>f.kind==='Charge'));
});
test('approved waterfall shape uses the existing original-cost and labelled estimate bridge',()=>{
 const state=sample(),r=buildMasterChart(state,selection),steps=waterfallSteps(r.facts);
 assert.equal(steps.length,6);assert.equal(steps[2].value,-r.totals.stock);assert.equal(steps[4].value,-5310);
 assert.equal(steps.slice(0,-1).reduce((s,p)=>s+p.value,0),r.totals.profit);assert.equal(steps.at(-1).end,r.totals.profit);
 delete state.salesHistory[0].financialSnapshot;assert.equal(waterfallSteps(buildMasterChart(state,selection).facts),null);
});
test('Hybrid styling is isolated and uses inherited SellQuanta typography; no live sample data imports',()=>{
 const require=createRequire(new URL('../client/package.json',import.meta.url)),postcss=require('postcss');
 const css=fs.readFileSync(new URL('../client/src/masterChartHybrid.css',import.meta.url),'utf8'),root=postcss.parse(css);
 root.walkRules(rule=>{for(const selector of rule.selectors)assert.match(selector.trim(),/^(\.master-chart\.hybrid-live|\.app\.master-chart-active|body:has\(\.master-chart\.hybrid-live\))/);});
 root.walkDecls('font-family',decl=>assert.equal(decl.value,'inherit'));
 for(const file of ['MasterChart.jsx','MasterChartHybrid.jsx','masterChartHybridModel.js','masterChartHybridCharts.jsx','masterChartHybridPanels.jsx']){
  const source=fs.readFileSync(new URL('../client/src/'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/demo\.js|filterDemo|demoPivot|initialFilters|DEMO-|fictional|Arjun|Glassworks|Homecraft|Daily Essentials/);
 }
});

test('live sidebar uses host dimensions and states; essential matrix text meets AA contrast',()=>{
 const require=createRequire(new URL('../client/package.json',import.meta.url)),postcss=require('postcss');
 const css=postcss.parse(fs.readFileSync(new URL('../client/src/masterChartHybrid.css',import.meta.url),'utf8'));
 const host=postcss.parse(fs.readFileSync(new URL('../client/src/styles.css',import.meta.url),'utf8'));
 const declarations=(root,selector)=>{const result={};root.walkRules(rule=>{if(rule.parent.type==='atrule'||!rule.selectors.includes(selector))return;rule.walkDecls(d=>{result[d.prop]=d.value;});});return result;};
 const base=declarations(host,'nav button'),live=declarations(css,'.master-chart.hybrid-live .sidebar nav button');
 for(const prop of ['height','padding','gap','border','border-radius','font-size','font-weight','color','background'])assert.equal(live[prop],base[prop],prop);
 assert.equal(declarations(css,'.master-chart.hybrid-live')['grid-template-columns'],'232px minmax(0,1fr)');
 for(const state of ['active','hover']){
  const original=declarations(host,'nav button'+(state==='active'?'.active':':hover'));
  const actual=declarations(css,'.master-chart.hybrid-live .sidebar nav button'+(state==='active'?'.active':':hover'));
  assert.equal(actual.background,original.background);assert.equal(actual.color,original.color);
 }
 assert.equal(declarations(css,'.master-chart.hybrid-live .sidebar nav button svg').width,'16px');
 assert.equal(declarations(css,'.master-chart.hybrid-live .product-name small')['font-size'],'12px');
 assert.equal(declarations(css,'.master-chart.hybrid-live .product-matrix td')['font-size'],'13px');
 const tokens=declarations(host,':root');
 const lum=hex=>{const values=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
 const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 for(const [fg,bg]of [['--ink','--surface'],['--ink-2','--surface'],['--ink-2','--recessed'],['--accent','--accent-soft'],['--warn','--warn-bg'],['--err','--err-bg']])assert.ok(contrast(tokens[fg],tokens[bg])>=4.5,`${fg}/${bg} contrast`);
});
