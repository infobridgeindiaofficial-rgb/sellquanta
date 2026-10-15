import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFacts,buildMasterChart,aggregateFacts,periodFor,previousPeriod,bucketDate} from '../client/src/masterChartData.js';
import {buildMasterPivot} from '../client/src/masterChartPivot.js';
import {sample} from './fixtures/master-chart.mjs';
const filters={from:'2026-09-01',to:'2026-09-30'};
test('Master Chart verified financial formulas, refund stock basis and Banking reconciliation',()=>{
 const s=sample(),before=structuredClone(s),r=buildMasterChart(s,filters),t=r.totals;
 assert.equal(t.gross,100000);assert.equal(t.refund,40000);assert.equal(t.revenue,60000);assert.equal(t.sold,10);assert.equal(t.net,6);assert.equal(t.orders,1);
 assert.equal(t.customer,2);assert.equal(t.rto,1);assert.equal(t.cancelled,1);assert.equal(t.returnRate,20);
 assert.equal(t.stock,24000);assert.equal(t.profit,6690);assert.equal(t.margin,11.15);assert.equal(t.settlement,48000);assert.equal(t.aov,100000);
 assert.equal(r.financial.due,48000-20000-5310);assert.equal(t.received,20000);assert.equal(r.purchaseTotal,10000);
 assert.equal(r.agents[0].due,32000);assert.equal(r.agents[0].paid,10000);assert.equal(r.agents[0].pending,22000);
 assert.deepEqual(s,before);
});
test('combined dimensions, archive copies, classifications, unique order counting and period semantics',()=>{
 const s=sample();s.monthCloseArchive=[{sales:[s.salesHistory[0]],refunds:[s.refunds[0]]}];s.returnCharges.push({...s.returnCharges[0],id:'copy'});
 const r=buildMasterChart(s,{...filters,marketplace:'Amazon',companyId:'c',agentId:'a',productId:'p'});assert.equal(r.totals.sold,10);assert.equal(r.totals.extra,5310);assert.equal(r.totals.customer,2);
 assert.equal(r.financial.due,null);assert.equal(r.inventory,null);
 assert.equal(buildMasterChart(s,{...filters,marketplace:'Meesho'}).totals.sold,0);
 const later=buildMasterChart(s,{from:'2026-09-20',to:'2026-09-20'});assert.equal(later.totals.sold,0);assert.equal(later.totals.extra,5310);assert.equal(later.totals.returnRate,null);assert.equal(later.financial.due,22690);
});
test('16 combinations of known dimensions retain the same uniquely attributed records',()=>{
 const state=sample(),keys=['marketplace','companyId','agentId','productId'],values=['Amazon','c','a','p'];
 for(let mask=0;mask<16;mask++){const scope={...filters};keys.forEach((key,i)=>{if(mask&(1<<i))scope[key]=values[i];});const r=buildMasterChart(state,scope);assert.equal(r.totals.revenue,60000);assert.equal(r.totals.extra,5310);assert.equal(r.totals.stock,24000);}
});
test('unknown refund amounts and nonnumeric captured estimates are not guessed; zero values remain valid',()=>{
 const state=sample();delete state.refunds[0].refundAmount;state.salesHistory[0].financialSnapshot.perUnit.estimated_profit='20';
 const r=buildMasterChart(state,filters);assert.equal(r.totals.refund,null);assert.equal(r.totals.revenue,null);assert.equal(r.totals.margin,null);assert.equal(r.totals.profit,null);
 state.refunds[0].refundAmount=0;state.salesHistory[0].financialSnapshot.perUnit.estimated_profit=0;
 assert.equal(buildMasterChart(state,filters).totals.profit,-5310);
});
test('current wallet resets and bank reversals follow shared helpers without period-based balance changes',()=>{
 const state=sample();state.walletResets=[{agentId:'a',excludedLedgerIds:['ls','lr','pay']}];
 state.bankSettlements.push({id:'reversal',kind:'receipt_reversal',originalReceiptId:'bank',marketplace:'Amazon',date:'2026-10-01',amountCents:-20000});
 const r=buildMasterChart(state,filters);assert.equal(r.agents[0].pending,0);assert.equal(r.financial.received,0);assert.equal(r.financial.due,48000-5310);assert.equal(r.totals.received,20000);
 assert.equal(buildMasterChart(state,{from:'2026-10-01',to:'2026-10-01'}).totals.received,-20000);
});
test('all grouping dimensions reconcile additive amounts while distinct order totals remain distinct',()=>{
 const r=buildMasterChart(sample(),filters);
 for(const name of ['products','marketplaces','companies','agents'])for(const metric of ['gross','revenue','sold','net','customer','rto','cancelled','refund','extra','stock','profit','settlement'])assert.equal(r.groups[name].reduce((s,g)=>s+g.totals[metric],0),r.totals[metric],name+metric);
});
test('product mapping requires unique company and marketplace; ambiguous charges do not get guessed',()=>{
 const state=sample();delete state.salesHistory[0].productId;
 state.productMaster=[{companyId:'c',marketplace:'Amazon',productId:'p',marketplaceSku:'P'}];
 assert.equal(buildMasterChart(state,filters).facts.find(f=>f.kind==='Sale').productId,'p');
 state.productMaster.push({companyId:'c',marketplace:'Amazon',productId:'q',marketplaceSku:'P'});
 const r=buildMasterChart(state,filters);assert.equal(r.facts.find(f=>f.kind==='Sale').productId,'');assert.ok(r.review.some(f=>f.kind==='Charge'));assert.equal(r.totals.extra,5310);
});
test('pivot keeps distinct entities with identical names separate and computes real column totals',()=>{
 const state=sample();state.products.push({id:'q',name:'Bottle',sku:'WH-Q'});state.salesHistory.push({...state.salesHistory[0],id:'s2',productId:'q',marketplace:'Meesho',qty:5,saleAmount:500});
 const facts=masterFacts(state).facts,p=buildMasterPivot(facts,{rows:['product'],column:'marketplace',metric:'returnRate'});
 assert.equal(p.groups.length,2);assert.equal(p.grand,2/15*100);assert.equal(p.grandCells[p.columns.indexOf('Amazon')],20);assert.equal(p.grandCells[p.columns.indexOf('Meesho')],0);
});
test('prior-period insights require actual sales in both periods and preserve chronological ranges',()=>{
 const state=sample();assert.equal(buildMasterChart(state,filters).comparable,false);
 state.salesHistory.push({...state.salesHistory[0],id:'prior',date:'2026-08-15'});
 const r=buildMasterChart(state,filters);assert.equal(r.comparable,true);assert.deepEqual(r.priorRange,{from:'2026-08-02',to:'2026-08-31'});assert.equal(r.prior.gross,100000);
});
test('missing captured values stay unavailable and unmatched/unconfirmed charges stay reviewable',()=>{
 const s=sample();delete s.salesHistory[0].financialSnapshot;s.returnCharges[0].sku='wrong';s.returnCharges.push({...s.returnCharges[0],id:'review',status:'Needs Review',amountCents:123});
 const r=buildMasterChart(s,filters);assert.equal(r.totals.profit,null);assert.equal(r.totals.extra,5310);assert.ok(r.review.length>=2);
 assert.equal(r.groups.products.find(g=>g.values[0]==='p').totals.extra,0);assert.equal(r.financial.estimated,null);
 assert.equal(buildMasterChart(s,{...filters,productId:'p'}).totals.extra,0);
});
test('pivot percentages use aggregated numerator/denominator, totals deduplicate orders across products',()=>{
 const facts=masterFacts(sample()).facts;
 const pivot=buildMasterPivot(facts,{rows:['product','marketplace'],column:'month',metric:'returnRate'});
 assert.equal(pivot.grand,20);assert.equal(pivot.subtotals[0].value,20);assert.equal(pivot.groups[0].cells[0],20);
 const s=sample();s.salesHistory.push({...s.salesHistory[0],id:'s2',productId:'q',qty:5,saleAmount:500});
 const f=masterFacts(s).facts;const orders=buildMasterPivot(f,{rows:['product'],metric:'orders'});assert.equal(orders.grand,1);assert.equal(orders.groups.reduce((a,g)=>a+g.value,0),2);
 assert.equal(aggregateFacts(f).returnRate,2/15*100);assert.equal(buildMasterPivot(f,{search:'not found'}).grand,0);
});
test('presets, previous periods, local weeks, empty data and invalid ranges',()=>{
 assert.deepEqual(periodFor('Last Month','2026-03-05'),{from:'2026-02-01',to:'2026-02-28'});
 assert.deepEqual(periodFor('Last 7 Days','2026-01-03'),{from:'2025-12-28',to:'2026-01-03'});
 assert.deepEqual(previousPeriod({from:'2026-09-01',to:'2026-09-07'}),{from:'2026-08-25',to:'2026-08-31'});
 assert.equal(bucketDate('2026-09-13','weekly'),'2026-09-07');
 const r=buildMasterChart({},filters);assert.equal(r.totals.revenue,0);assert.equal(r.totals.returnRate,null);assert.equal(r.comparable,false);
 assert.throws(()=>buildMasterChart({}, {from:'2026-09-31',to:'2026-09-30'}),/valid/);
});
