import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {bankReceiptHistory,bankReconciliationPreview} from '../server/bankReconciliation.mjs';
import {registerBankStatementRoutes} from '../server/bankStatementRoutes.mjs';

const legacy={id:'legacy',marketplace:'Flipkart',date:'2026-09-20',amountCents:304923,reference:'TEST-REF',version:1};
const row=(overrides={})=>({date:'2026-09-20',reference:'TEST-REF',creditCents:304923,debitCents:0,narration:'Synthetic settlement',detection:{marketplace:'Flipkart'},...overrides});

test('four-field exact candidate still needs manual confirmation; amount-only and missing refs cannot resolve provenance',()=>{
 const db={bankSettlements:[legacy],bankingAudit:[{settlementId:'legacy',action:'create',at:'2026-09-20',after:legacy}]};const before=structuredClone(db);
 const view=bankReconciliationPreview(db,[row(),row({date:'2026-09-19',reference:'OTHER',detection:{marketplace:'Amazon'}})]);
 assert.equal(view.unresolvedCount,1);assert.equal(view.receipts[0].resolved,false);
 assert.match(view.receipts[0].candidates[0].strength,/All four/);assert.match(view.receipts[0].candidates[1].strength,/Amount only/);
 assert.equal(view.receipts[0].auditEntries.length,1);assert.match(view.receipts[0].aggregation.provenance,/Unknown/);
 const empty=bankReconciliationPreview({bankSettlements:[{...legacy,reference:''}]},[row({reference:''})]);assert.equal(empty.receipts[0].candidates[0].comparisons.reference,false);
 assert.deepEqual(db,before);
});

test('aggregated equality is reported only as a possibility, with no mutation or automatic resolution',()=>{
 const view=bankReconciliationPreview({bankSettlements:[legacy]},[row({creditCents:100000,reference:'A'}),row({creditCents:204923,reference:'B'})]);
 assert.equal(view.receipts[0].aggregation.sumEqualsReceipt,true);assert.equal(view.receipts[0].resolved,false);
});

test('history reads latest versions and retained deletions, reports unknown source honestly and handles absent target',()=>{
 const db={bankSettlements:[legacy,{...legacy,version:2,amountCents:400000},{id:'other',marketplace:'Meesho',date:'2026-10-12',amountCents:100,deletedAt:'2026-10-13',entrySource:'Manual'}]};
 const before=structuredClone(db),history=bankReceiptHistory(db);
 assert.equal(history.length,2);assert.equal(history.find(r=>r.id==='legacy').amountCents,400000);
 assert.equal(history.find(r=>r.id==='legacy').displaySource,'Legacy / Unknown');assert.equal(history.find(r=>r.id==='other').displayStatus,'Deleted (retained)');
 const view=bankReconciliationPreview(db);assert.equal(view.unresolvedCount,1);assert.match(view.note,/preserved/);assert.deepEqual(db,before);
});

test('read-only receipt history API and confirmed import attempts never change existing collections',async t=>{
 const db={bankSettlements:[legacy],ledger:[{id:'wallet'}],bankingAudit:[{settlementId:'legacy',action:'create'}]},before=structuredClone(db);
 const app=express();app.use(express.json());registerBankStatementRoutes(app,{readDb:()=>structuredClone(db)});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}/api/banking`;
 const response=await fetch(base+'/receipts');assert.equal(response.status,200);const history=await response.json();assert.equal(history.receipts[0].id,'legacy');assert.equal(history.reconciliation.unresolvedCount,1);
 const result=await fetch(base+'/statement/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,reconciliationResolved:true,approvedRows:[row()]})});assert.equal(result.status,409);assert.equal((await result.json()).saved,0);assert.deepEqual(db,before);
});
