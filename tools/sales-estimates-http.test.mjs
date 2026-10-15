import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolveScanRow } from '../client/src/autoDetect.js';
import { dashboardStats, localToday } from '../client/src/dashboardStats.js';

test('real API: manual and resolved shipping labels capture all markets/companies, survive price edits/restarts, refunds and undo',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),live=path.join(root,'data/stockpilot.json'),liveBefore=JSON.parse(fs.readFileSync(live));
 const dir=fs.mkdtempSync(path.join(root,'tmp/sales-estimates-http-'));fs.mkdirSync(path.join(dir,'data'));
 const dbFile=path.join(dir,'data/stockpilot.json'),markets=['Amazon','Flipkart','Meesho'];
 const initial={meta:{version:1},companies:[{id:'c1',name:'One'},{id:'c2',name:'Two'}],agents:[{id:'a1',name:'First',companyId:'c1'},{id:'a2',name:'Second',companyId:'c2'}],accounts:['a1','a2'].flatMap(agentId=>markets.map(marketplace=>({id:agentId+marketplace,agentId,marketplace}))),products:[{id:'p',sku:'PDN',name:'Product',stock:100,costPrice:20}],productMaster:['c1','c2'].flatMap(companyId=>markets.map(marketplace=>({id:companyId+marketplace,companyId,marketplace,marketplaceSku:companyId+marketplace+'SKU',productName:'Product',productId:'p',listing_price:250,cost_price:80,estimated_settlement:150,estimated_profit:33}))),todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[],walletResets:[],bankSettlements:[{amount:90000}]};
 fs.writeFileSync(dbFile,JSON.stringify(initial));const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 let child;const req=(route,method='GET',body)=>fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const start=async()=>{child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:path.join(dir,'no-client')},windowsHide:true,stdio:'ignore'});for(let i=0;i<100;i++){try{if((await req('/server-info')).ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw Error('Isolated server failed');};
 const stop=async()=>{if(child?.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});};t.after(async()=>{await stop();assert.deepEqual(JSON.parse(fs.readFileSync(live)),liveBefore);});
 await start();const state=async()=>await(await req('/state')).json(),month=localToday().slice(0,7),saved=[];
 for(const companyId of ['c1','c2'])for(const marketplace of markets){
  const current=await state(),sku=companyId+marketplace+'SKU';
  const resolved=resolveScanRow({sku,productName:'Product',_pageText:marketplace,orderId:'SCAN-'+companyId+marketplace,qty:3,saleAmount:0},current);assert.equal(resolved.status,'Matched');assert.equal(resolved.product.sku,'PDN');
  const scanned={agentId:resolved.agent.id,accountId:resolved.account.id,productId:resolved.product.id,marketplaceSku:resolved.sku,qty:3,saleAmount:0,orderId:'SCAN-'+companyId+marketplace,source:'ollama-label'};
  let r=await req('/sales','POST',[scanned]);assert.equal(r.status,200);const sale=(await r.json())[0];saved.push(sale);
  assert.equal(sale.financialSnapshot.mappingId,companyId+marketplace);assert.equal(sale.financialSnapshot.perUnit.cost_price,80);assert.equal(sale.financialSnapshot.totals.listing_price,750);assert.equal(sale.financialSnapshot.totals.estimated_settlement,450);assert.equal(sale.financialSnapshot.totals.estimated_profit,99);
  assert.equal((await req('/sales','POST',[scanned])).status,400,'Scanned order retry cannot duplicate a sale');
  const manual={agentId:resolved.agent.id,accountId:resolved.account.id,productId:'p',qty:2,saleAmount:100,orderId:'MANUAL-'+companyId+marketplace,source:'manual'};
  r=await req('/sales','POST',[manual]);assert.equal(r.status,200);assert.equal((await r.json())[0].financialSnapshot.totals.estimated_profit,66);
 }
 let current=await state(),d=dashboardStats(current,month);assert.equal(d.totals.sales,600);assert.equal(d.estimates.estimated_settlement.amount,4500);assert.equal(d.estimates.estimated_profit.amount,990);assert.equal(current.products[0].stock,70);
 assert.equal((await req('/product-master/c1Amazon/product','POST',{productId:'p',updateName:false,estimated_settlement:999,estimated_profit:-10})).status,200);
 current=await state();assert.equal(dashboardStats(current,month).estimates.estimated_profit.amount,990);assert.deepEqual(current.todaySales.find(s=>s.id===saved[0].id),saved[0]);
 await stop();await start();current=await state();assert.equal(dashboardStats(current,month).estimates.estimated_settlement.amount,4500);
 const refund=await req('/refunds','POST',{saleId:saved[0].id, refundReason: 'Customer Return'});assert.equal(refund.status,200);const returned=await refund.json();assert.equal(returned.financialSnapshot.perUnit.estimated_profit,33);
 assert.equal((await req('/refunds','POST',{saleId:saved[0].id})).status,400);
 current=await state();d=dashboardStats(current,month);assert.equal(d.estimates.estimated_settlement.amount,4050);assert.equal(d.estimates.estimated_profit.amount,891);assert.equal(current.products[0].stock,73);
 const reversal=await req('/sales/undo-last-batch','POST',{});assert.equal(reversal.status,200);current=await state();d=dashboardStats(current,month);assert.equal(d.estimates.estimated_profit.amount,825);assert.equal(d.totals.sales,500);assert.equal(current.products[0].stock,75);
 assert.deepEqual(current.bankSettlements,initial.bankSettlements);assert.equal(current.products[0].costPrice,20);assert.equal(dashboardStats(current,'2000-01').estimates.estimated_profit.amount,0);
});
