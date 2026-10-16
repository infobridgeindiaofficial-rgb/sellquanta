import test from 'node:test';
import assert from 'node:assert/strict';
import {productReturnAnalysis as report, dashboardReturnMonths} from '../client/src/productReturnReport.js';

export function fixture() {
  const sale = (id,productId,marketplace,qty,extra={}) => ({id,productId,marketplace,qty,companyId:'c',date:'2026-09-10',orderId:id,marketplaceSku:productId+'-sku',...extra});
  return {products:[{id:'p',name:'Mint bottle',sku:'W1'},{id:'q',name:'Tea cup',sku:'W2'}],agents:[],
    productMaster:[{companyId:'c',productId:'p',marketplace:'Amazon',marketplaceSku:'p-sku'}],
    salesHistory:[sale('a','p','Amazon',10),sale('b','q','Flipkart',5),sale('m','p','Meesho',4)],todaySales:[],
    refunds:[{id:'r',saleId:'a',refundDate:'2026-09-12',qty:2,refundAmount:100,refundReason:'Customer Return'},
      {id:'rto',saleId:'a',refundDate:'2026-09-12',qty:1,refundAmount:50,refundReason:'RTO'},
      {id:'cancel',saleId:'b',refundDate:'2026-09-13',qty:1,refundAmount:30,refundReason:'Cancelled'}],
    returnCharges:[{id:'fee',duplicateKey:'fee-key',marketplace:'Amazon',date:'2026-09-14',orderId:'a',sku:'p-sku',amountCents:1234,status:'Confirmed'}]};
}
const month={month:'2026-09'};
test('classifications, weighted percentages, saved refund amounts and immutable state',()=>{
  const state=fixture(),before=structuredClone(state),r=report(state,month);
  assert.equal(r.summary.sold,19);assert.equal(r.summary.customerReturns,2);
  assert.equal(r.summary.returnPercentage,2/19*100);assert.equal(r.summary.rto,1);assert.equal(r.summary.cancelled,1);
  assert.equal(r.summary.refundCents,18000);assert.equal(r.summary.confirmedChargeCents,1234);
  const p=r.rows.find(r=>r.marketplace==='Amazon');assert.equal(p.returnPercentage,20);assert.equal(p.chargeCents,1234);
  assert.equal(r.review.length,0);assert.deepEqual(state,before);
});
test('marketplace and inclusive date filters use each transaction date, matching earlier sales',()=>{
  const state=fixture();assert.equal(report(state,month,'Amazon').summary.sold,10);
  assert.equal(report(state,month,'Flipkart').summary.customerReturns,0);
  assert.equal(report(state,month,'Meesho').summary.sold,4);
  const r=report(state,{fromDate:'2026-09-14',toDate:'2026-09-14'});
  assert.equal(r.summary.sold,0);assert.equal(r.rows[0].chargeCents,1234);assert.equal(r.summary.returnPercentage,null);
  assert.equal(report(state,{month:'2026-10'}).rows.length,0);
  assert.equal(report(state,{fromDate:'2026-09-12',toDate:'2026-09-12'}).summary.customerReturns,2);
});
test('archive copies, refund copies and repeated charge IDs / fingerprints count once',()=>{
  const state=fixture();state.monthCloseArchive=[{sales:[state.salesHistory[0]],refunds:[state.refunds[0]]}];
  state.returnCharges.push({...state.returnCharges[0],id:'copy'}, {...state.returnCharges[0],duplicateKey:'different-key'});
  state.salesHistory.push({...state.salesHistory[0]});
  const r=report(state,month);assert.equal(r.summary.sold,19);assert.equal(r.summary.customerReturns,2);assert.equal(r.summary.confirmedChargeCents,1234);
});
test('order and marketplace plus SKU/product validation; ambiguous lines stay separate',()=>{
  const state=fixture();state.salesHistory.push({...state.salesHistory[0],id:'other',productId:'q',marketplaceSku:'q-sku'});
  const base=state.returnCharges[0];
  state.returnCharges=[base,
    {...base,id:'ambiguous',duplicateKey:'ambiguous',sku:''},
    {...base,id:'wrong-sku',duplicateKey:'wrong-sku',sku:'wrong'},
    {...base,id:'wrong-market',duplicateKey:'wrong-market',marketplace:'Meesho'},
    {...base,id:'wrong-product',duplicateKey:'wrong-product',productId:'q'},
    {...base,id:'missing-order',duplicateKey:'missing-order',orderId:''}];
  const r=report(state,month);assert.equal(r.review.length,5);
  assert.equal(r.rows.find(r=>r.productId==='p'&&r.marketplace==='Amazon').chargeCents,1234);
  assert.equal(r.rows.find(r=>r.productId==='q'&&r.marketplace==='Amazon').chargeCents,0);
});
test('Warehouse code and company-scoped Product Master identify legacy sales without name guesses',()=>{
  const state=fixture();delete state.salesHistory[0].productId;
  assert.equal(report(state,month).rows.find(r=>r.marketplace==='Amazon').productId,'p');
  state.salesHistory[0].warehouseProductCode='W1';delete state.salesHistory[0].marketplaceSku;
  assert.equal(report(state,month).rows.find(r=>r.marketplace==='Amazon').productId,'p');
  delete state.salesHistory[0].warehouseProductCode;state.salesHistory[0].productName='Mint bottle';
  const r=report(state,month);assert.equal(r.rows.find(r=>r.marketplace==='Amazon').productId,undefined);assert.equal(r.review.length,1);
});
test('missing amounts and unclassified refunds are explicit; unconfirmed charges never enter totals',()=>{
  const state=fixture();delete state.refunds[0].refundReason;delete state.refunds[0].refundAmount;
  state.returnCharges.push({...state.returnCharges[0],id:'missing',duplicateKey:'missing',amountCents:null},
    {...state.returnCharges[0],id:'review',duplicateKey:'review',status:'Needs Review',amountCents:2000});
  const r=report(state,month);assert.equal(r.summary.customerReturns,0);assert.equal(r.summary.unclassified,2);
  assert.equal(r.summary.missingRefunds,1);assert.equal(r.summary.missingCharges,1);assert.equal(r.summary.confirmedChargeCents,1234);assert.equal(r.review.length,2);
});
test('zero sales denominator is unavailable; cross-period returns are not capped or relabelled',()=>{
  const state=fixture();state.refunds[0].refundDate='2026-10-01';
  const r=report(state,{month:'2026-10'});assert.equal(r.summary.sold,0);assert.equal(r.summary.customerReturns,2);assert.equal(r.rows[0].returnPercentage,null);
});
test('undated charges remain visible for review without being assigned to a financial period',()=>{
  const state=fixture();state.returnCharges[0].date='';
  const r=report(state,month);assert.equal(r.review.length,1);assert.match(r.review[0].reviewReason,/date/);
  assert.equal(r.summary.confirmedChargeCents,0);assert.equal(r.rows.find(r=>r.marketplace==='Amazon').chargeCents,0);
});
test('₹53.10 Amazon charge uses September expense date despite October sale/import and exposes charge-only month',()=>{
  const state=fixture(),orderId='406-4079649-7363539';
  state.products[0].name='400ml Glass Inner Water Bottle';
  state.salesHistory=[{id:'bottle-sale',productId:'p',marketplace:'Amazon',companyId:'c',marketplaceSku:'PGG140005',date:'2026-10-14',orderId,qty:1}];
  state.refunds=[];
  const charge={id:'bottle-charge',duplicateKey:'bottle-key',marketplace:'Amazon',date:'2026-09-20',dateBasis:'date/time',importedAt:'2026-10-14T21:16:32.084Z',orderId,sku:'PGG140005',amountCents:5310,status:'Confirmed'};
  state.returnCharges=[charge,{...charge,id:'duplicate'}, {...charge,id:'unconfirmed',duplicateKey:'unconfirmed',status:'Needs Review'}];
  const original=structuredClone(state);
  assert.ok(dashboardReturnMonths(state).includes('2026-09'));
  const october=report(state,{month:'2026-10'});
  assert.equal(october.summary.confirmedChargeCents,0);assert.equal(october.outsidePeriod.length,1);
  for (const options of [{month:'2026-09'},{fromDate:'2026-09-20',toDate:'2026-09-20'}]) {
    const r=report(state,options,'Amazon');assert.equal(r.summary.confirmedChargeCents,5310);
    const row=r.rows.find(r=>r.productId==='p');assert.equal(row.productName,'400ml Glass Inner Water Bottle');assert.equal(row.chargeCents,5310);assert.equal(row.sold,0);
  }
  assert.equal(report(state,{month:'2026-09'},'Flipkart').summary.confirmedChargeCents,0);
  assert.equal(report(state,{fromDate:'2026-09-21',toDate:'2026-09-30'}).summary.confirmedChargeCents,0);
  assert.deepEqual(state,original);
  state.returnCharges=[{...charge,sku:'wrong-sku'}];
  const unmatched=report(state,{month:'2026-09'});assert.equal(unmatched.summary.confirmedChargeCents,5310);
  assert.equal(unmatched.review.length,1);assert.equal(unmatched.rows.reduce((s,r)=>s+r.chargeCents,0),0);
});
