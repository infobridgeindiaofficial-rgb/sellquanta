import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScanRow } from '../client/src/autoDetect.js';
import { financialMapping, captureFinancialSnapshot } from '../server/financialSnapshot.mjs';

const fixture=()=>({companies:[{id:'c1',name:'First'},{id:'c2',name:'Second'}],agents:[{id:'a1',companyId:'c1'},{id:'a2',companyId:'c2'}],accounts:['Amazon','Flipkart','Meesho'].flatMap(marketplace=>['a1','a2'].map(agentId=>({id:agentId+marketplace,agentId,marketplace}))),products:[{id:'p1',sku:'PDN1'},{id:'p2',sku:'PDN2'}],productMaster:['Amazon','Flipkart','Meesho'].flatMap(marketplace=>[{id:'c1'+marketplace,companyId:'c1',marketplace,marketplaceSku:'SAME',productId:'p1',productName:'First product',listing_price:150,cost_price:90,estimated_settlement:120,estimated_profit:7},{id:'c2'+marketplace,companyId:'c2',marketplace,marketplaceSku:'SAME',productId:'p2',productName:'Second product',listing_price:300,cost_price:100,estimated_settlement:200,estimated_profit:15}])});

test('identified companies, agents and accounts restrict lookup; absent company hints retain ambiguity safeguards',()=>{
 const ctx=fixture();
 for(const marketplace of ['Amazon','Flipkart','Meesho']){
  assert.equal(resolveScanRow({sku:'SAME',marketplace},ctx).status,'Needs Review');
  const found=resolveScanRow({sku:'SAME',marketplace,companyId:'c1',agentId:'a1',accountId:'a1'+marketplace},ctx);
  assert.equal(found.status,'Matched');assert.equal(found.product.sku,'PDN1');assert.equal(found.company.id,'c1');
  const mapping=financialMapping(ctx.productMaster,{companyId:found.company.id,marketplace:found.marketplace,marketplaceSku:found.sku,productId:found.product.id});
  assert.deepEqual(captureFinancialSnapshot(mapping,3).totals,{listing_price:450,cost_price:270,estimated_settlement:360,estimated_profit:21});
  assert.equal(resolveScanRow({sku:'SAME',marketplace,companyName:'Second'},ctx).product.sku,'PDN2');
  assert.equal(resolveScanRow({sku:'SAME',marketplace,companyId:'c1',agentId:'a2'},ctx).status,'Needs Review');
 }
});

test('unknown company/SKU and wrong marketplace never borrow mappings; missing financial fields do not invalidate a mapping',()=>{
 const ctx=fixture();ctx.productMaster=ctx.productMaster.filter(m=>m.companyId==='c2'&&m.marketplace==='Amazon');
 let result=resolveScanRow({sku:'SAME',marketplace:'Amazon',companyId:'c1'},ctx);assert.equal(result.status,'Not Found');assert.equal(result.company.id,'c1');assert.equal(result.product,null);assert.match(result.reason,/SAME.*Amazon/);
 assert.equal(resolveScanRow({sku:'SAME',marketplace:'Flipkart',companyId:'c2'},ctx).status,'Not Found');
 assert.equal(resolveScanRow({sku:'SAME',marketplace:'Amazon',companyId:'missing'},ctx).status,'Not Found');
 delete ctx.productMaster[0].estimated_profit;result=resolveScanRow({sku:'SAME',marketplace:'Amazon',companyId:'c2'},ctx);assert.equal(result.status,'Matched');
 const snapshot=captureFinancialSnapshot(ctx.productMaster[0],2);assert.equal(snapshot.perUnit.estimated_profit,null);assert.equal(snapshot.totals.estimated_profit,null);assert.equal(snapshot.totals.estimated_settlement,400);
});
