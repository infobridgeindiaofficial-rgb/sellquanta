import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {validateManualReceipt} from '../client/src/manualBankReceipt.js';
import {createBankReceiptPersistence} from '../server/bankReceiptImport.mjs';
import {registerBankStatementRoutes} from '../server/bankStatementRoutes.mjs';

const receipt={marketplace:'Amazon',date:'2026-10-14',amount:'123.45',reference:'SYNTHETIC-UTR',notes:'Synthetic test only',requestId:'manual_test_001'};
test('manual validation requires marketplace, real date, positive precise amount and actual reference',()=>{
 assert.equal(validateManualReceipt(receipt).value.amountCents,12345);
 for(const change of [{marketplace:'Other'},{date:'2026-02-30'},{date:''},{amount:'0'},{amount:'-1'},{amount:'1.001'},{amount:'NaN'},{reference:''},{reference:'---'},{reference:'0'},{notes:'x'.repeat(2001)}])assert.equal(validateManualReceipt({...receipt,...change}).valid,false);
 assert.equal(validateManualReceipt(null).valid,false);
});

test('manual API saves all marketplaces with existing atomic store, preserves records, rejects duplicates and persists after restart',async t=>{
 const dir=fs.mkdtempSync(path.resolve('tmp/manual-bank-http-')),file=path.join(dir,'db.json');
 const original={meta:{version:1},bankSettlements:[{id:'legacy',marketplace:'Meesho',date:'2026-01-01',amountCents:5000}],ledger:[{id:'keep-wallet'}],products:[{id:'keep-stock'}]};
 fs.writeFileSync(file,JSON.stringify(original));
 const app=express();app.use(express.json());registerBankStatementRoutes(app,{readDb:()=>JSON.parse(fs.readFileSync(file)),persist:createBankReceiptPersistence({dbFile:file,backupDir:path.join(dir,'backups')})});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}/api/banking`;
 const post=body=>fetch(base+'/receipts/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const [index,marketplace] of ['Amazon','Flipkart','Meesho'].entries()) {
const input={...receipt,marketplace,reference:`TEST-UTR-${index}`,requestId:`manual_market_${index}`};const response=await post(input);assert.equal(response.status,200);const result=await response.json();assert.equal(result.saved,1);
    const saved=result.history.receipts.find(item=>item.reference===input.reference);assert.equal(saved.displaySource,'Manual');assert.equal(saved.displayStatus,'Active');assert.equal(saved.notes,receipt.notes);
   assert.equal((await post({...input,requestId:`different_request_${index}`})).status,409);
   const retry=await(await post(input)).json();assert.equal(retry.replayed,true);
 }
 assert.equal((await post({...receipt,reference:'',requestId:'invalid_request'})).status,400);
 const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.bankSettlements.length,4);assert.deepEqual(saved.bankSettlements[0],original.bankSettlements[0]);assert.deepEqual(saved.ledger,original.ledger);assert.deepEqual(saved.products,original.products);
 assert.equal(saved.bankingAudit.filter(item=>item.action==='manual_receipt').length,3);
 const history=await(await fetch(base+'/receipts')).json();assert.equal(history.receipts.length,4);
 const restarted=createBankReceiptPersistence({dbFile:file,backupDir:path.join(dir,'backups')});
 const tx={id:'manual',date:receipt.date,reference:'TEST-UTR-0',narration:receipt.notes,notes:receipt.notes,creditCents:12345,debitCents:0,detection:{status:'Confirmed',marketplace:'Amazon'}};
 assert.equal(restarted([{transaction:tx,marketplace:'Amazon',classificationSource:'Manual',approved:true}],{requestId:'restart_request',entrySource:'Manual'}).duplicates,1);
 assert.equal(fs.readdirSync(path.join(dir,'backups')).length,3);
});
