import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {localToday,saleDay,dashboardStats} from '../client/src/dashboardStats.js';
import {manualSaleDate} from '../server/manualSaleDate.mjs';
import {salesForDate} from '../client/src/salesHistoryFilter.js';
import {salesReturnsReport} from '../server/reports.mjs';
import {bankingReport} from '../server/banking.mjs';

import {buildReportsWorkbook} from '../server/reportExcel.mjs';

test('manual calendar validation rejects future and invalid dates, preserves past leap dates',()=>{
 const now=new Date(2026,9,15,0,5);
 for(const value of ['',undefined,'2026-02-29','2026-13-01','2026-10-16','0000-01-01'])assert.throws(()=>manualSaleDate(value,now));
 for(const value of ['2026-10-15','2026-09-30','2000-02-29','0001-01-01'])assert.equal(manualSaleDate(value,now),value);
 const legacy={source:'manual',date:'2000-01-01',createdAt:'2026-10-15T12:00:00'};
 assert.equal(saleDay(legacy),'2026-10-15');assert.equal(saleDay({...legacy,saleDate:'2000-01-01'}),'2000-01-01');
 assert.equal(saleDay({...legacy,source:'ollama-label',saleDate:'2000-01-01'}),'2026-10-15');
});

test('manual API stores selected sale day; history, released Dashboard, banking, reports and workbook use that day',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),live=path.join(root,'tools/fixtures/business/data/stockpilot.json'),before=fs.readFileSync(live);
 const dir=fs.mkdtempSync(path.join(root,'tmp/manual-sale-date-'));fs.mkdirSync(path.join(dir,'data'));
 const file=path.join(dir,'data/stockpilot.json');
 fs.writeFileSync(file,JSON.stringify({meta:{version:1},companies:[{id:'c',name:'C'}],agents:[{id:'a',name:'A',companyId:'c'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon'}],products:[{id:'p',sku:'PDN',name:'P',stock:10,costPrice:5}],productMaster:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[]}));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:path.join(dir,'no-dist'),SELLQUANTA_SKIP_STARTUP_WRITES:'1'},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});assert.ok(fs.readFileSync(live).equals(before));});
 const req=(route,body)=>fetch(`http://127.0.0.1:${port}/api${route}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 let ready=false;for(let i=0;i<100;i++){try{if((await req('/server-info')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}assert.ok(ready);
 const today=localToday(),now=new Date(),prior=new Date(now.getFullYear(),now.getMonth()-1,15),past=localToday(prior);
 const sale={agentId:'a',accountId:'ac',productId:'p',qty:2,saleAmount:50,source:'manual'};
 for(const date of ['', '2099-01-01','2026-02-30']){const saved=fs.readFileSync(file);assert.equal((await req('/sales',[{...sale,saleDate:date}])).status,400);assert.ok(fs.readFileSync(file).equals(saved));}
 for(const date of [today,past]){
  const response=await req('/sales',[{...sale,saleDate:date,orderId:date}]);assert.equal(response.status,200);
  const [saved]=await response.json();assert.equal(saved.date,date);assert.equal(saved.saleDate,date);assert.equal(saved.createdAt.slice(0,4),today.slice(0,4));
 }
 const state=await(await req('/state')).json();assert.equal(state.products[0].stock,6);
 assert.equal(state.ledger.reduce((sum,row)=>sum+row.amount,0),20);assert.ok(state.todaySales.every(s=>s.financialSnapshot&&s.financialSnapshot.perUnit.estimated_profit===null));
 for(const date of [today,past]){
  assert.equal(salesForDate(state,date).length,1);
  assert.equal(dashboardStats(state,date.slice(0,7)).totals.sales,50);
  assert.equal(salesReturnsReport(state,{mode:'custom',from:date,to:date}).totals.unitsSold,2);
  assert.equal(bankingReport(state,{mode:'daily',date}).totals.salesCents,5000);
  const selection={mode:'daily',date};assert.equal(salesReturnsReport(state,selection).sales[0].reportDate,date);
  const {workbook:wb}=buildReportsWorkbook(state,selection);assert.equal(wb.Sheets.Sales.B2.v,date);
  assert.ok(state.ledger.some(l=>l.referenceId===state.todaySales.find(s=>s.date===date).id&&l.date===date));
  const exported=await req('/reports/export?mode=daily&date='+date);assert.equal(exported.status,200);assert.ok((await exported.arrayBuffer()).byteLength>0);
 }
 const saved=fs.readFileSync(file);assert.equal((await req('/sales',[{...sale,source:'ollama-label',orderId:past}])).status,400);assert.ok(fs.readFileSync(file).equals(saved));
});
