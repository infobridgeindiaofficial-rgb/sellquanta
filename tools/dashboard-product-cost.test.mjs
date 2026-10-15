import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardProductCost} from '../client/src/dashboardProductCost.js';

test('saved cost totals include quantity once, deduplicate sales and follow inclusive period filters',()=>{
  const a={id:'a',date:'2026-09-01',qty:3,costTotal:60.15};
  const b={id:'b',date:'2026-09-30',qty:2,financialSnapshot:{perUnit:{cost_price:12.34}}};
  const c={id:'c',date:'2026-10-01',qty:4,costTotal:100};
  const state={todaySales:[a,b,c],salesHistory:[a],refunds:[{id:'r',saleId:'a',qty:1,refundDate:'2026-09-02',costAmount:20.05}],products:[{cost:999}],productMaster:[]};
  const before=structuredClone(state);
  assert.equal(dashboardProductCost(state,{month:'2026-09'}),64.78);
  assert.equal(dashboardProductCost(state,{month:'2026-10'}),100);
  assert.equal(dashboardProductCost(state,{fromDate:'2026-09-30',toDate:'2026-10-01'}),124.68);
  assert.equal(dashboardProductCost(state,{fromDate:'2026-09-01',toDate:'2026-09-01'}),60.15);
  assert.deepEqual(state,before);
});

test('empty periods show zero; missing saved costs are unavailable rather than inferred from current mappings',()=>{
 const state={todaySales:[{id:'a',date:'2026-09-01',qty:3,productId:'p'}],products:[{id:'p',cost:999}],salesHistory:[],refunds:[]};
 assert.equal(dashboardProductCost(state,{month:'2026-10'}),0);
 assert.equal(dashboardProductCost(state,{month:'2026-09'}),null);
});
