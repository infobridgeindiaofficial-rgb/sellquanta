import test from 'node:test';import assert from 'node:assert/strict';
import {dashboardStats} from '../client/src/dashboardStats.js';
import {confirmedPeriodCharges} from '../client/src/returnChargeProfit.js';
const sale={id:'sale',date:'2026-09-01',orderId:'ORDER',marketplaceSku:'SKU',companyId:'c',marketplace:'Amazon',qty:2,saleAmount:300,costTotal:40,financialSnapshot:{perUnit:{estimated_settlement:100,estimated_profit:70}}};
const charge={id:'charge',duplicateKey:'original-charge',date:'2026-09-15',orderId:'ORDER',sku:'SKU',marketplace:'Amazon',status:'Confirmed',amountCents:2000};
const state=records=>({companies:[{id:'c',name:'Company'}],agents:[],accounts:[],products:[],ledger:[],productMaster:[],todaySales:[sale],salesHistory:[],refunds:[],returnCharges:records});
test('confirmed saved charge reduces profit once, by marketplace and charge period; settlement and other figures unchanged',()=>{
 const db=state([charge]),before=structuredClone(db),baseline=dashboardStats(state([]),{month:'2026-09'}),adjusted=dashboardStats(db,{month:'2026-09'});
 assert.equal(adjusted.estimates.estimated_profit.amount,120);assert.equal(adjusted.companies[0].estimates.estimated_profit.amount,120);assert.equal(adjusted.companies[0].marketplaces.find(m=>m.marketplace==='Amazon').estimates.estimated_profit.amount,120);
 assert.deepEqual(adjusted.estimates.estimated_settlement,baseline.estimates.estimated_settlement);assert.deepEqual(adjusted.totals,baseline.totals);assert.deepEqual(db,before);
 assert.equal(dashboardStats(db,{fromDate:'2026-09-15',toDate:'2026-09-15'}).estimates.estimated_profit.amount,-20);
 assert.equal(dashboardStats(db,{month:'2026-10'}).estimates.estimated_profit.amount,0);
});
test('Needs Review and preview-only rows do not reduce profit, duplicate saved imports deduct once',()=>{
 assert.equal(dashboardStats(state([{...charge,status:'Needs Review'}]),{month:'2026-09'}).estimates.estimated_profit.amount,140);
 assert.equal(confirmedPeriodCharges([{...charge,id:undefined}],{month:'2026-09'}).length,0);
 const records=[{...charge,status:'Needs Review'},charge,{...charge,id:'duplicate'}];assert.equal(dashboardStats(state(records),{month:'2026-09'}).estimates.estimated_profit.amount,120);
});
test('product refunds are not deducted twice; ambiguous company links only affect overall profit',()=>{
 const db=state([charge]);db.refunds=[{id:'refund',saleId:'sale',refundDate:'2026-09-14',companyId:'c',marketplace:'Amazon',qty:1,refundAmount:150}];
 assert.equal(dashboardStats(db,{month:'2026-09'}).estimates.estimated_profit.amount,50);
 const ambiguous=state([charge]);ambiguous.companies.push({id:'other',name:'Other'});ambiguous.todaySales.push({...sale,id:'other',companyId:'other'});
 const result=dashboardStats(ambiguous,{month:'2026-09'});assert.equal(result.estimates.estimated_profit.amount,260);assert.deepEqual(result.companies.map(c=>c.estimates.estimated_profit.amount),[140,140]);
});
