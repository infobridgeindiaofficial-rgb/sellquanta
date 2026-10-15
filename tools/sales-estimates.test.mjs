import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStats } from '../client/src/dashboardStats.js';
import { captureFinancialSnapshot, financialMapping } from '../server/financialSnapshot.mjs';

const fixture=()=>({companies:[{id:'c1',name:'One'},{id:'c2',name:'Two'}],agents:[{id:'a1',companyId:'c1'},{id:'a2',companyId:'c2'}],products:[{id:'p',sku:'PDN',name:'Product',stock:100,costPrice:5}],accounts:[],ledger:[],todaySales:[],salesHistory:[],refunds:[],bankSettlements:[{amount:999999}],productMaster:['c1','c2'].flatMap(companyId=>['Amazon','Flipkart','Meesho'].map(marketplace=>({id:companyId+marketplace,companyId,marketplace,marketplaceSku:companyId+'SKU',productId:'p',listing_price:200,cost_price:75,estimated_settlement:120.25,estimated_profit:17.50})))});
const sale=(state,id,companyId='c1',marketplace='Amazon',qty=3,date='2026-01-15',captured=true)=>{
 const row={id,companyId,agentId:companyId==='c1'?'a1':'a2',marketplace,marketplaceSku:companyId+'SKU',productId:'p',date,qty,saleAmount:450,costTotal:15,orderId:id};
 if(captured)row.financialSnapshot=captureFinancialSnapshot(financialMapping(state.productMaster,row),qty);
 return row;
};

test('all companies and marketplaces share quantity-based captured estimates independently of invoice and bank receipts',()=>{
 const state=fixture();for(const c of ['c1','c2'])for(const m of ['Amazon','Flipkart','Meesho'])state.todaySales.push(sale(state,c+m,c,m));
 const before=structuredClone(state),d=dashboardStats(state,'2026-01',new Date('2026-01-15T12:00:00Z'));
 assert.equal(d.totals.sales,2700);assert.equal(d.totals.qty,18);assert.equal(d.estimates.estimated_settlement.amount,2164.5);assert.equal(d.estimates.estimated_profit.amount,315);
 for(const c of d.companies){assert.equal(c.estimates.estimated_profit.amount,157.5);for(const m of c.marketplaces)assert.equal(m.estimates.estimated_settlement.amount,360.75);}
 assert.deepEqual(state,before);assert.equal(d.today.qty,18);
});

test('captured values stay immutable; legacy values are inferred with provenance; missing and zero values remain distinct',()=>{
 const state=fixture();state.todaySales=[sale(state,'new')];state.salesHistory=[sale(state,'old','c1','Amazon',2,'2026-01-12',false)];
 state.productMaster[0].estimated_profit=-8.5;state.productMaster[0].estimated_settlement=0;
 let d=dashboardStats(state,'2026-01');assert.equal(d.estimates.estimated_profit.amount,35.5);assert.equal(d.estimates.estimated_profit.capturedQuantity,3);assert.equal(d.estimates.estimated_profit.inferredQuantity,2);assert.equal(d.estimates.estimated_settlement.amount,360.75);
 delete state.productMaster[0].estimated_profit;d=dashboardStats(state,'2026-01');assert.equal(d.estimates.estimated_profit.amount,null);assert.equal(d.estimates.estimated_profit.missingQuantity,2);assert.equal(d.estimates.estimated_profit.knownAmount,52.5);
 state.productMaster=[];assert.equal(dashboardStats(state,'2026-01').estimates.estimated_settlement.amount,null);
 const absent=sale(state,'absent');state.todaySales=[absent];state.salesHistory=[];state.productMaster=fixture().productMaster;
 assert.equal(dashboardStats(state,'2026-01').estimates.estimated_profit.amount,null,'A missing-at-sale snapshot cannot silently infer values added later');
});

test('duplicate archive/open sales and refund copies, partial refunds and cross-month refunds count once',()=>{
 const state=fixture(),original=sale(state,'s');state.todaySales=[original];state.salesHistory=[structuredClone(original)];
 const refund={id:'r1',saleId:'s',companyId:'c1',agentId:'a1',marketplace:'Amazon',productId:'p',refundDate:'2026-01-20',qty:1,refundAmount:150};
 state.refunds=[refund,structuredClone(refund)];let d=dashboardStats(state,'2026-01');assert.equal(d.totals.qty,2);assert.equal(d.totals.sales,300);assert.equal(d.estimates.estimated_profit.amount,35);
 state.refunds.push({...refund,id:'r2',refundDate:'2026-02-01',qty:2,refundAmount:300});
 d=dashboardStats(state,'2026-01');assert.equal(d.estimates.estimated_settlement.amount,240.5);
 d=dashboardStats(state,'2026-02');assert.equal(d.estimates.estimated_settlement.amount,-240.5);assert.equal(d.estimates.estimated_profit.amount,-35);assert.equal(d.totals.sales,-300);
 state.refunds.push({...refund,id:'copy',refundDate:'2026-02-02',qty:3,refundAmount:450});assert.equal(dashboardStats(state,'2026-02').totals.sales,-300);
 state.refunds=[];state.salesHistory=[];state.todaySales=[];assert.equal(dashboardStats(state,'2026-01').estimates.estimated_profit.amount,0);
});

test('mapping resolution never leaks another company/marketplace or guesses an ambiguous manual mapping',()=>{
 const state=fixture(),row=sale(state,'s');assert.equal(financialMapping(state.productMaster,row).id,'c1Amazon');
 assert.equal(financialMapping(state.productMaster,{...row,marketplaceSku:'missing'}),null);
 assert.equal(financialMapping(state.productMaster,{...row,marketplaceSku:''}).id,'c1Amazon');
 state.productMaster.push({...state.productMaster[0],id:'other',marketplaceSku:'OTHER'});assert.equal(financialMapping(state.productMaster,{...row,marketplaceSku:''}),null);
});
