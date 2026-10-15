import test from 'node:test';
import assert from 'node:assert/strict';
import {bankingSummary} from '../client/src/bankingSummary.js';
import {captureFinancialSnapshot} from '../server/financialSnapshot.mjs';
import {dashboardStats} from '../client/src/dashboardStats.js';

test('all-time saved estimates respect quantity, archived copies, all receipt sources and negative dues',()=>{
 const sales=['Amazon','Flipkart','Meesho'].map((marketplace,i)=>({id:'s'+i,marketplace,date:['2024-01-01','2025-09-01','2026-10-01'][i],qty:i+1,financialSnapshot:captureFinancialSnapshot({estimated_settlement:100},i+1)}));
 const state={todaySales:sales,salesHistory:[sales[0]],refunds:[],productMaster:[{estimated_settlement:999}],dashboardFilter:{month:'2026-10'}};
 const receipts=[{id:'a',date:'2023-01-01',reference:'UTR-A',marketplace:'Amazon',amountCents:15000,entrySource:'Manual'},{id:'b',date:'2026-10-01',reference:'UTR-B',marketplace:'Flipkart',amountCents:5000,entrySource:'Statement'},{id:'c',date:'2027-01-01',reference:'UTR-C',marketplace:'Meesho',amountCents:3000,entrySource:'Manual'}];
 receipts.push({...receipts[0]},{...receipts[1],id:'copy'},{id:'gone',marketplace:'Amazon',amountCents:99900,deletedAt:'2026-10-01'});
 const before=structuredClone({state,receipts});
 const rows=bankingSummary(state,receipts);
 assert.deepEqual(rows.map(r=>[r.estimatedCents,r.receivedCents,r.dueCents]),[[10000,15000,-5000],[20000,5000,15000],[30000,3000,27000],[60000,23000,37000]]);
 assert.deepEqual(bankingSummary({...state,dashboardFilter:{fromDate:'2026-10-01',toDate:'2026-10-02'}},receipts),rows);
 assert.deepEqual(bankingSummary(JSON.parse(JSON.stringify(state)),JSON.parse(JSON.stringify(receipts))),rows);
 assert.deepEqual({state,receipts},before);
});

test('captured per-unit values respect quantity; missing estimates without a valid mapping remain unavailable',()=>{
 const state={todaySales:[{id:'a',marketplace:'Amazon',qty:3,financialSnapshot:{perUnit:{estimated_settlement:12.34}}},{id:'b',marketplace:'Meesho',qty:2}],productMaster:[{marketplace:'Meesho',estimated_settlement:999}]};
 const rows=bankingSummary(state,[]);
 assert.equal(rows[0].estimatedCents,3702);assert.equal(rows[1].estimatedCents,0);
 assert.equal(rows[2].estimatedCents,null);assert.equal(rows[2].dueCents,null);assert.equal(rows[3].estimatedCents,null);
});

test('legacy Amazon mapping matches Dashboard; all historical archives persist and captured values take precedence',()=>{
 const mapping={id:'m',companyId:'c',marketplace:'Amazon',productId:'p',marketplaceSku:'SKU',estimated_settlement:123.45};
 const legacy={id:'legacy',agentId:'a',marketplace:'Amazon',productId:'p',marketplaceSku:'SKU',date:'2026-10-10',qty:3,saleAmount:600};
 const captured={...legacy,id:'captured',qty:2,financialSnapshot:captureFinancialSnapshot({...mapping,estimated_settlement:50},2)};
 const historical={...legacy,id:'historic',date:'2023-01-01',qty:1};
 const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',name:'Agent',companyId:'c'}],products:[],accounts:[],ledger:[],productMaster:[mapping],todaySales:[legacy,captured],salesHistory:[],monthCloseArchive:[{sales:[historical,legacy]}],refunds:[]};
 const before=structuredClone(state);
 const dashboard=dashboardStats(state,{month:'2026-10'});
 assert.equal(dashboard.estimates.estimated_settlement.amount,470.35);
 const summary=bankingSummary(state,[]);
 assert.equal(summary[0].estimatedCents,59380);assert.equal(summary[0].missing,0);
 assert.equal(summary[0].estimatedCents-Math.round(mapping.estimated_settlement*100),Math.round(dashboard.estimates.estimated_settlement.amount*100));
 assert.deepEqual(bankingSummary(JSON.parse(JSON.stringify(state)),[]),summary);
 assert.deepEqual(state,before);
});

test('same Dashboard settlement helper preserves its existing refund and duplicate handling',()=>{
 const sale={id:'s',date:'2026-10-10',marketplace:'Amazon',qty:3,saleAmount:300,financialSnapshot:captureFinancialSnapshot({estimated_settlement:70},3)};
 const refund={id:'r',saleId:'s',refundDate:'2026-10-12',marketplace:'Amazon',qty:1,refundAmount:100};
 const state={companies:[],agents:[],products:[],accounts:[],ledger:[],todaySales:[sale],salesHistory:[sale],refunds:[refund,refund]};
 assert.equal(bankingSummary(state,[])[0].estimatedCents,14000);
 assert.equal(dashboardStats(state,{month:'2026-10'}).estimates.estimated_settlement.amount,140);
});

test('latest receipt version is used, tombstones respected, new sales and receipts update totals',()=>{
 const state={todaySales:[]};
 const receipts=[{id:'a',version:1,marketplace:'Amazon',amountCents:100},{id:'a',version:2,marketplace:'Amazon',amountCents:250},{id:'b',version:1,marketplace:'Amazon',amountCents:100},{id:'b',version:2,deletedAt:'now',marketplace:'Amazon',amountCents:100}];
 assert.equal(bankingSummary(state,receipts)[0].receivedCents,250);
 state.todaySales.push({id:'s',marketplace:'Amazon',qty:2,financialSnapshot:captureFinancialSnapshot({estimated_settlement:10},2)});
 receipts.push({id:'new',marketplace:'Amazon',amountCents:500});
 assert.equal(bankingSummary(state,receipts)[0].dueCents,1250);
});
