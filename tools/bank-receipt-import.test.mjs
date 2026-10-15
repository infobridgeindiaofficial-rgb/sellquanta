import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {prepareReceiptImport,createBankReceiptPersistence} from '../server/bankReceiptImport.mjs';
import {registerBankStatementRoutes} from '../server/bankStatementRoutes.mjs';
import {statementPdfPages} from './fixtures/banking-statements.mjs';
import {dashboardBankSummary} from '../client/src/dashboardBankSummary.js';

const row=(changes={})=>({id:'row-1',date:'2026-08-01',reference:'SYNTHETIC-REF',narration:'NEFT/MEESHO PAY',creditCents:10000,debitCents:0,balanceCents:20000,valueDate:'2026-08-01',sources:[{page:1,row:1}],originalRows:[['synthetic']],accountKey:'synthetic-hash',detection:{status:'Confirmed',marketplace:'Meesho'},...changes});
const selection=(transaction=row())=>({transaction,marketplace:'Meesho',classificationSource:'Rule',approved:true});
const initial=()=>({meta:{version:1},companies:[],products:[],agents:[],ledger:[{id:'unchanged-wallet'}],bankSettlements:[{id:'legacy',marketplace:'Amazon',date:'2026-10-12',amountCents:12345,notes:'Preserve exactly',version:1}],bankingAudit:[{id:'old',action:'create'}],bankingRequests:[{id:'old-request'}],custom:{untouched:true}});

test('append-only approved credit import, provenance/batch/audit, no financial collection changes, persistent replay and duplicate protection',()=>{
 const db=initial(),before=structuredClone(db);
 const imported=prepareReceiptImport(db,[selection()],{requestId:'request_first'});assert.equal(imported.result.saved,1);assert.deepEqual(db,before);
 assert.deepEqual(imported.db.bankSettlements[0],db.bankSettlements[0]);
 for(const key of ['meta','companies','products','agents','ledger','custom'])assert.deepEqual(imported.db[key],db[key]);
 const receipt=imported.db.bankSettlements[1];assert.equal(receipt.narration,row().narration);assert.equal(receipt.reference,row().reference);assert.equal(receipt.entrySource,'Statement');assert.equal(receipt.classificationSource,'Rule');assert.ok(receipt.importBatchId);assert.equal(imported.db.bankingAudit.length,2);
 const replay=prepareReceiptImport(imported.db,[selection()],{requestId:'request_first'});assert.equal(replay.changed,false);assert.equal(replay.result.replayed,true);
 const duplicate=prepareReceiptImport(imported.db,[selection(row({narration:'different rendering'}))],{requestId:'request_second'});assert.equal(duplicate.result.saved,0);assert.equal(duplicate.result.duplicates,1);assert.equal(duplicate.changed,false);
 const relabeled=prepareReceiptImport(imported.db,[{...selection(),marketplace:'Amazon',classificationSource:'Manual'}],{requestId:'request_third'});assert.equal(relabeled.result.saved,0);
 assert.equal(dashboardBankSummary(imported.db,'2026-08',{amount:null,inferredQuantity:0,missingQuantity:0}).received,100);
});

test('invalid approval, excluded/debit rows, AI mismatch, reused request ID and uncertain blank-reference legacy overlap fail closed',()=>{
 const db=initial();
 for(const bad of [{...selection(),approved:false},selection(row({debitCents:1})),selection(row({detection:{status:'Other / Excluded'}})),{...selection(),marketplace:'Amazon'},{...selection(),classificationSource:'Ollama Suggested'}])assert.throws(()=>prepareReceiptImport(db,[bad],{requestId:'invalid_request'}));
 const existing={...db,bankSettlements:[{id:'old',date:'2026-08-01',amountCents:10000,reference:''}]};assert.throws(()=>prepareReceiptImport(existing,[selection()],{requestId:'overlap_request'}),/overlap/);
 const imported=prepareReceiptImport(db,[selection()],{requestId:'replay_request'});assert.throws(()=>prepareReceiptImport(imported.db,[selection(row({creditCents:20000}))],{requestId:'replay_request'}),/different selections/);
});

test('verified backup and atomic persistence survive refresh/restart; write/backup failure leaves original bytes',()=>{
 const dir=fs.mkdtempSync(path.resolve('tmp/bank-import-')),file=path.join(dir,'db.json'),backups=path.join(dir,'backups');fs.writeFileSync(file,JSON.stringify(initial()));const original=fs.readFileSync(file);
 const persist=createBankReceiptPersistence({dbFile:file,backupDir:backups});assert.equal(persist([selection()],{requestId:'atomic_request'}).saved,1);
 const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.bankSettlements.length,2);assert.ok(fs.readFileSync(path.join(backups,fs.readdirSync(backups)[0])).equals(original));
 assert.equal(createBankReceiptPersistence({dbFile:file,backupDir:backups})([selection()],{requestId:'after_restart'}).duplicates,1);
 const beforeFailure=fs.readFileSync(file),other=selection(row({id:'row-2',date:'2026-08-02',reference:'OTHER'}));
 for(const failing of ['writeFileSync','renameSync']) {
   const io={...fs,[failing]:(...args)=>{if(failing==='writeFileSync'||args[1]===file)throw new Error('Injected atomic failure');return fs[failing](...args);}};
   assert.throws(()=>createBankReceiptPersistence({dbFile:file,backupDir:backups,io})([other],{requestId:'failed_request'}));assert.ok(fs.readFileSync(file).equals(beforeFailure));
 }
 const concurrent={...fs,writeFileSync:(target,...args)=>{fs.writeFileSync(target,...args);if(typeof target==='string'&&target.startsWith(backups))fs.writeFileSync(file,JSON.stringify({...saved,externalChange:true}));}};
 assert.throws(()=>createBankReceiptPersistence({dbFile:file,backupDir:backups,io:concurrent})([other],{requestId:'changed_request'}),/changed during backup/);assert.equal(JSON.parse(fs.readFileSync(file)).externalChange,true);
});

test('real preview tokens enforce approval and immutable originals, saving persists and repeated uploads do not duplicate',async t=>{
 const dir=fs.mkdtempSync(path.resolve('tmp/bank-import-http-')),file=path.join(dir,'db.json');fs.writeFileSync(file,JSON.stringify(initial()));
 const app=express();app.use(express.json());const persist=createBankReceiptPersistence({dbFile:file,backupDir:path.join(dir,'backups')});
 const routes=()=>registerBankStatementRoutes(app,{readDb:()=>JSON.parse(fs.readFileSync(file)),persist,advise:async preview=>({...preview,aiStatus:'Synthetic offline'})});routes();
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}/api/banking`;
 const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const scan=await(await post('/statement/preview',{filename:'synthetic.pdf',pages:statementPdfPages(),useOllama:false})).json();assert.equal(scan.savingEnabled,true);
 const selected=scan.rows.filter(item=>item.detection.marketplace&&!item.duplicate).map(item=>({scanToken:scan.scanToken,rowId:item.id,marketplace:item.detection.marketplace,classificationSource:'Rule',approved:true}));
 const payload={confirm:true,verificationComplete:true,requestId:'http_request_first',selections:selected};
 assert.equal((await post('/statement/import',{...payload,confirm:false})).status,409);
 assert.equal((await post('/statement/import',{...payload,selections:[{...selected[0],creditCents:1}]})).status,409);
 const before=JSON.parse(fs.readFileSync(file));const response=await post('/statement/import',payload);assert.equal(response.status,200);assert.equal((await response.json()).saved,5);
 const history=await(await fetch(base+'/receipts')).json();assert.equal(history.receipts.length,6);assert.equal(history.receipts.filter(item=>item.displaySource==='Statement').length,5);
 assert.equal((await(await post('/statement/import',payload)).json()).replayed,true);
 const repeated=await(await post('/statement/preview',{filename:'synthetic.pdf',pages:statementPdfPages(),useOllama:false})).json();assert.equal(repeated.rows.filter(item=>item.detection.marketplace&&item.status==='Duplicate').length,6);
 const after=JSON.parse(fs.readFileSync(file));assert.equal(after.bankSettlements.length,6);assert.deepEqual(after.bankSettlements[0],before.bankSettlements[0]);assert.deepEqual(after.ledger,before.ledger);
});
