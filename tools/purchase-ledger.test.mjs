import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import express from 'express';
import {validatePurchase,totalPurchaseCents,registerPurchaseRoutes} from '../server/purchaseLedger.mjs';
const input={date:'2026-10-14',supplier:'',product:'Product',quantity:3,costPrice:'41.15',notes:'Optional note',requestId:'purchase-test-request'};
test('purchase validation and cumulative amount do not multiply entry amount by quantity',()=>{
 assert.equal(validatePurchase(input).amountCents,12345);assert.equal(validatePurchase({...input,supplier:''}).supplier,'');assert.equal(validatePurchase({...input,supplier:'Valid Supplier'}).supplier,'Valid Supplier');
 for(const fields of [{date:'2026-02-30'},{supplier:'x'.repeat(201)},{product:''},{quantity:0},{quantity:1.5},{costPrice:'0'},{costPrice:'1.234'},{notes:'x'.repeat(2001)}])assert.throws(()=>validatePurchase({...input,...fields}));
 assert.equal(totalPurchaseCents(),0);assert.equal(totalPurchaseCents([{id:'a',amountCents:12345},{id:'a',amountCents:12345},{id:'b',amountCents:100}]),12445);
});
test('save/read API persists, retry does not duplicate, rejects invalid entries and leaves all other records unchanged',async t=>{
 const dir=fs.mkdtempSync(path.resolve('tmp/purchases-test-')),file=path.join(dir,'db.json');
 const original={products:[{id:'p',stock:10}],todaySales:[{id:'sale',qty:1}],ledger:[{id:'ledger'}],bankSettlements:[{id:'receipt'}]};fs.writeFileSync(file,JSON.stringify(original));
 const readDb=()=>JSON.parse(fs.readFileSync(file));const app=express();app.use(express.json());registerPurchaseRoutes(app,{readDb,mutate:fn=>{const db=readDb(),result=fn(db);fs.writeFileSync(file,JSON.stringify(db));return result;}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}/api/purchases`;
 const post=body=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post(input)).status,201);assert.equal((await post(input)).status,200);assert.equal((await post({...input,costPrice:'1'})).status,409);assert.equal((await post({...input,quantity:0})).status,400);
 const history=await (await fetch(base)).json();assert.equal(history.purchases.length,1);assert.equal(history.totalCents,12345);
 const db=readDb();for(const key of Object.keys(original))assert.deepEqual(db[key],original[key]);
 // Fresh Node processes exercise the actual local store's atomic write/read pattern.
 const script=`const {mutate,readDb}=await import('./server/store.mjs');mutate(db=>{(db.purchases||=[]).push({id:'second',amountCents:100})});console.log(readDb().purchases.length);`;
 const env={...process.env,SELLQUANTA_DATA_ROOT:dir};fs.mkdirSync(path.join(dir,'data'));fs.copyFileSync(file,path.join(dir,'data/stockpilot.json'));
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/2/);
 const restart=spawnSync(process.execPath,['--input-type=module','-e',`const {readDb}=await import('./server/store.mjs');console.log(readDb().purchases.length);`],{env,encoding:'utf8'});assert.equal(restart.status,0,restart.stderr);assert.match(restart.stdout,/2/);
});

test('Qty 12 x cost price 150 saves total 1800; cumulative totals use total, not unit price, preserving legacy values',()=>{
 const saved=validatePurchase({...input,quantity:12,costPrice:'150'});assert.equal(saved.costPriceCents,15000);assert.equal(saved.totalCents,180000);assert.equal(saved.amountCents,180000);
 const rows=[{id:'new',...saved},{id:'old',amountCents:500},{id:'legacy',totalCents:1000},{id:'invalid',totalCents:'bad'}],before=structuredClone(rows);
 assert.equal(totalPurchaseCents(rows),181500);assert.deepEqual(rows,before);
 assert.throws(()=>validatePurchase({...input,quantity:Number.MAX_SAFE_INTEGER,costPrice:'150'}));
});
