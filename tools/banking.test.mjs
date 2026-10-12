import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import ExcelJS from 'exceljs';
import {bankingReport,applySettlement} from '../server/banking.mjs';
import {buildBankingWorkbook} from '../server/bankingRoutes.mjs';
import {writeBrandedWorkbook,INR_FORMAT} from '../server/excelStyle.mjs';

const body=(m='Amazon',extra={})=>({requestId:'request_'+crypto.randomUUID(),marketplace:m,date:'2026-10-12',amount:'80.23',reference:'UTR-1',notes:'Test only',...extra});
const fixture=()=>{const old={id:'old',marketplace:'Amazon',date:'2026-09-30',saleAmount:100,qty:1,unitCost:1};const sale={id:'a',marketplace:'Amazon',date:'2026-10-12',saleAmount:200,qty:2,unitCost:1};return {meta:{version:1},products:[],agents:[],companies:[],accounts:[],productMaster:[],todaySales:[sale,{id:'f',marketplace:'Flipkart',date:'2026-10-11',saleAmount:50.25},{id:'m',marketplace:'Meesho',createdAt:'2026-10-12T23:59:59.999Z',saleAmount:30},{id:'u',marketplace:'Amazon',saleAmount:4}],salesHistory:[old,sale],monthCloseArchive:[{sales:[old,sale],refunds:[{id:'r',saleId:'a',refundDate:'2026-10-12',refundAmount:100,qty:1}]}],refunds:[{id:'r',saleId:'a',refundDate:'2026-10-12',refundAmount:100,qty:1}],ledger:[{id:'credit',type:'PAYMENT',amount:5}],stockMovements:[],walletResets:[]};};
test('all-time and inclusive UTC periods reconcile all three markets, archives and separate gross refunds',()=>{
 const db=fixture();applySettlement(db,'create',null,body());applySettlement(db,'create',null,body('Flipkart',{reference:'F',date:'2026-10-01',amount:'25.10'}));applySettlement(db,'create',null,body('Meesho',{reference:'M',amount:'40'}));
 const before=JSON.stringify(db),all=bankingReport(db);assert.equal(all.totals.salesCents,38425);assert.equal(all.totals.receivedCents,14533);assert.equal(all.totals.differenceCents,23892);assert.equal(all.undatedSales,1);assert.equal(all.marketplaces[2].differenceCents,-1000);
 const monthly=bankingReport(db,{mode:'monthly',month:'2026-10'});assert.equal(monthly.totals.salesCents,28025);assert.equal(monthly.totals.receivedCents,14533);
 const daily=bankingReport(db,{mode:'daily',date:'2026-10-12'});assert.equal(daily.totals.salesCents,23000);assert.equal(daily.totals.receivedCents,12023);
 const weekly=bankingReport(db,{mode:'weekly',date:'2026-10-12'});assert.equal(weekly.range.from,'2026-10-12');assert.equal(weekly.range.to,'2026-10-18');assert.equal(weekly.totals.salesCents,23000);
 const custom=bankingReport(db,{mode:'custom',from:'2026-09-30',to:'2026-10-01'});assert.equal(custom.totals.salesCents,10000);assert.equal(custom.totals.receivedCents,2510);
 const history=bankingReport(db,{marketplace:'Amazon',search:'utr'});assert.equal(history.history.length,1);assert.deepEqual(history.totals,all.totals);assert.equal(JSON.stringify(db),before);
 assert.deepEqual(bankingReport({}).totals,{salesCents:0,receivedCents:0,differenceCents:0});
 for(const filter of [{mode:'monthly',month:'2026-13'},{mode:'custom',from:'2026-10-12',to:'2026-10-01'},{mode:'daily',date:'2026-02-30'},{mode:'yearly',year:2026},{marketplace:'Other'}])assert.throws(()=>bankingReport(db,filter));
});
test('multiple receipts, exact cents, idempotency, duplicates, correction versions, tombstones and audit snapshots',()=>{
 const db=fixture(),source=structuredClone(db),input=body(),created=applySettlement(db,'create',null,input),id=created.settlement.id;
 assert.equal(created.settlement.amountCents,8023);assert.equal(applySettlement(db,'create',null,input).replayed,true);assert.equal(db.bankingAudit.length,1);
 assert.throws(()=>applySettlement(db,'create',null,{...input,amount:'1'}),/request ID/);
 assert.throws(()=>applySettlement(db,'create',null,body('Amazon',{reference:'utr-1'})),/already exists/);
 applySettlement(db,'create',null,body('Amazon',{reference:'UTR-2'}));applySettlement(db,'create',null,body('Amazon',{reference:'',amount:'10'}));assert.throws(()=>applySettlement(db,'create',null,body('Amazon',{reference:'',amount:'10'})),/already exists/);
 const edit=body('Flipkart',{amount:'90.12',reference:'F',version:1,confirm:true});const corrected=applySettlement(db,'update',id,edit);assert.equal(corrected.settlement.version,2);assert.equal(db.bankingAudit.at(-1).before.amountCents,8023);assert.equal(db.bankingAudit.at(-1).after.amountCents,9012);assert.equal(applySettlement(db,'update',id,edit).replayed,true);
 assert.throws(()=>applySettlement(db,'update',id,body('Amazon',{confirm:true,version:1})),/changed/);
 assert.throws(()=>applySettlement(db,'update',id,body('Amazon',{version:2})),/Confirm/);
 const deletion={requestId:body().requestId,version:2,confirm:true};applySettlement(db,'delete',id,deletion);assert.equal(applySettlement(db,'delete',id,deletion).replayed,true);assert.equal(bankingReport(db).history.length,2);assert.equal(db.bankSettlements.length,3);assert.ok(db.bankingAudit.at(-1).after.deletedAt);
 for(const key of Object.keys(source))assert.deepEqual(db[key],source[key],key+' unchanged');
});
test('invalid inputs never mutate any records; monetary overflow and invalid saved amount are reported',()=>{
 const db=fixture(),before=JSON.stringify(db);
 for(const extra of [{amount:0},{amount:'-1'},{amount:'1.234'},{amount:'NaN'},{amount:Infinity},{amount:'1e3'},{amount:'10000000000'},{date:'2026-02-29'},{date:'not-a-date'},{marketplace:'Other'},{reference:'<script>'},{reference:'x'.repeat(201)},{notes:'x'.repeat(2001)},{notes:'bad\u0000value'},{requestId:'short'}])assert.throws(()=>applySettlement(db,'create',null,body('Amazon',extra)));
 assert.equal(JSON.stringify(db),before);assert.throws(()=>bankingReport({todaySales:[{marketplace:'Amazon',saleAmount:'bad'}]}),/invalid amount/);
});
test('three branded sheets support populated/empty workbooks and preserve typed references',async()=>{
 const db=fixture();applySettlement(db,'create',null,body('Amazon',{reference:'000001',notes:'=literal'}));
 for(const data of [db,{}]){const report=bankingReport(data),book=new ExcelJS.Workbook();await book.xlsx.load(await writeBrandedWorkbook(buildBankingWorkbook(report),{reportName:'Banking Reconciliation',period:'All Time'}));assert.deepEqual(book.worksheets.map(s=>s.name),['Banking Summary','Marketplace Breakdown','Settlement History']);for(const sheet of book.worksheets){assert.equal(sheet.getCell('A1').value,'SellQuanta');assert.equal(sheet.views[0].ySplit,6);assert.ok(sheet.autoFilter);assert.equal(sheet.getCell('A6').fill.fgColor.argb,'FF166534');}assert.equal(book.worksheets[0].getCell('B7').numFmt,INR_FORMAT);assert.equal(book.worksheets[1].getCell('D7').numFmt,INR_FORMAT);if(data===db){assert.equal(book.worksheets[2].getCell('D7').value,'000001');assert.equal(book.worksheets[2].getCell('E7').value,'=literal');}}
});
test('isolated live CRUD/export, failed atomic save, backups, restart and production-data protection',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),live=path.join(root,'data/stockpilot.json'),liveBefore=fs.existsSync(live)?fs.readFileSync(live):null;
 const dir=fs.mkdtempSync(path.join(root,'tmp/banking-http-'));fs.mkdirSync(path.join(dir,'data'));const file=path.join(dir,'data/stockpilot.json');fs.writeFileSync(file,JSON.stringify(fixture()));
 const marker=path.join(dir,'fail'),hook=path.join(dir,'fail-save.mjs');fs.writeFileSync(hook,`import fs from 'node:fs';const original=fs.renameSync;fs.renameSync=function(a,b){if(b===${JSON.stringify(file)}&&fs.existsSync(${JSON.stringify(marker)}))throw Error('Simulated save failure');return original.apply(this,arguments);};`);
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));let child;
 const req=(route,method='GET',body)=>fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const start=async()=>{child=spawn(process.execPath,['--import',pathToFileURL(hook).href,path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:path.join(dir,'no-client')},windowsHide:true,stdio:'ignore'});for(let i=0;i<150;i++){try{if((await req('/server-info')).ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}assert.fail('Isolated backend startup failed');};
 const stop=async()=>{if(child?.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});};t.after(async()=>{await stop();if(liveBefore)assert.ok(fs.readFileSync(live).equals(liveBefore));});await start();
 const baseline=JSON.parse(fs.readFileSync(file)),input=body();const created=await(await req('/banking/settlements','POST',input)).json();assert.ok(created.settlement);const stable=fs.readFileSync(file);assert.equal((await(await req('/banking/settlements','POST',input)).json()).replayed,true);assert.ok(fs.readFileSync(file).equals(stable));
 for(const m of ['Flipkart','Meesho'])assert.equal((await req('/banking/settlements','POST',body(m))).status,200);
 assert.equal((await req('/banking/settlements','POST',body())).status,409);assert.equal((await req('/banking/settlements','POST',body('Amazon',{amount:'0'}))).status,400);
 const id=created.settlement.id,update=body('Amazon',{reference:'NEW',amount:'81',version:1,confirm:true});assert.equal((await req('/banking/settlements/'+id,'PUT',update)).status,200);assert.equal((await req('/banking/settlements/'+id,'DELETE',{requestId:body().requestId,version:2})).status,400);
 const deletion={requestId:body().requestId,version:2,confirm:true};assert.equal((await req('/banking/settlements/'+id,'DELETE',deletion)).status,200);assert.equal((await(await req('/banking/audit')).json()).entries.length,5);
 fs.writeFileSync(marker,'fail');const failure=body('Amazon',{reference:'FAIL'}),bytes=fs.readFileSync(file);assert.equal((await req('/banking/settlements','POST',failure)).status,400);assert.ok(fs.readFileSync(file).equals(bytes));fs.unlinkSync(marker);assert.equal((await req('/banking/settlements','POST',failure)).status,200);
 const readonly=fs.readFileSync(file);for(const query of ['mode=all','mode=daily&date=2026-10-12','mode=weekly&date=2026-10-12','mode=monthly&month=2026-10','mode=custom&from=2026-10-01&to=2026-10-12']){assert.equal((await req('/banking?'+query)).status,200);const response=await req('/banking/export?'+query);assert.equal(response.status,200);const sample=Buffer.from(await response.arrayBuffer()),book=new ExcelJS.Workbook();await book.xlsx.load(sample);assert.equal(book.worksheets.length,3);fs.writeFileSync(path.join(dir,'Banking-'+new URLSearchParams(query).get('mode')+'.xlsx'),sample);}assert.ok(fs.readFileSync(file).equals(readonly));
 const current=JSON.parse(readonly);for(const key of Object.keys(baseline))assert.deepEqual(current[key],baseline[key],key+' unchanged');
 const backup=await(await req('/backup','POST',{})).json();assert.equal(backup.ok,true);const restored=JSON.parse(fs.readFileSync(path.join(dir,backup.file)));assert.deepEqual(restored.bankSettlements,current.bankSettlements);assert.deepEqual(restored.bankingAudit,current.bankingAudit);
 await stop();await start();assert.equal((await(await req('/banking/settlements','POST',failure)).json()).replayed,true);assert.equal((await(await req('/banking/settlements/'+id,'DELETE',deletion)).json()).replayed,true);assert.equal((await(await req('/banking')).json()).history.length,3);assert.ok(fs.readFileSync(file).equals(readonly));
 console.log('Synthetic Banking Excel samples: '+dir);
});
