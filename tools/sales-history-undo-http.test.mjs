import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { localToday } from '../client/src/dashboardStats.js';

test('undo request guards reject changed batches and other dates atomically without changing original reversal behavior',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),live=path.join(root,'data/stockpilot.json'),before=JSON.parse(fs.readFileSync(live));
 const dir=fs.mkdtempSync(path.join(root,'tmp/sales-history-undo-'));fs.mkdirSync(path.join(dir,'data'));
 const file=path.join(dir,'data/stockpilot.json');fs.writeFileSync(file,JSON.stringify({meta:{version:1},companies:[{id:'c',name:'C'}],agents:[{id:'a',name:'A',companyId:'c'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon'}],products:[{id:'p',sku:'PDN',name:'P',stock:10,costPrice:5}],productMaster:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[]}));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:path.join(dir,'no-dist')},windowsHide:true,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});assert.deepEqual(JSON.parse(fs.readFileSync(live)),before);});
 const req=(route,body)=>fetch(`http://127.0.0.1:${port}/api${route}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 let ready=false;for(let i=0;i<100;i++){try{if((await req('/server-info')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}assert.ok(ready);
 const sell=async orderId=>(await(await req('/sales',[{agentId:'a',accountId:'ac',productId:'p',qty:2,saleAmount:50,orderId,source:'manual'}])).json())[0];
 const first=await sell('first'),last=await sell('last'),saved=fs.readFileSync(file);
 assert.equal((await req('/sales/undo-last-batch',{expectedBatchId:first.batchId,selectedDate:localToday()})).status,400);assert.ok(fs.readFileSync(file).equals(saved));
 assert.equal((await req('/sales/undo-last-batch',{expectedBatchId:last.batchId,selectedDate:'2000-01-01'})).status,400);assert.ok(fs.readFileSync(file).equals(saved));
 assert.equal((await req('/sales/undo-last-batch',{expectedBatchId:last.batchId,selectedDate:localToday()})).status,200);
 let state=await(await req('/state')).json();assert.equal(state.todaySales.length,1);assert.equal(state.todaySales[0].id,first.id);assert.equal(state.products[0].stock,8);assert.equal(state.ledger.filter(l=>l.type==='SALE').length,1);
 assert.equal((await req('/sales/undo-last-batch',{expectedBatchId:last.batchId,selectedDate:localToday()})).status,400);state=await(await req('/state')).json();assert.equal(state.products[0].stock,8);
 assert.equal((await req('/sales/undo-last-batch',{})).status,200,'Existing callers without a guard retain original API behavior');
});
