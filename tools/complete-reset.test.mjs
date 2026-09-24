import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import XLSX from 'xlsx';
import { createCompleteReset } from '../server/completeReset.mjs';
import { dashboardStats } from '../client/src/dashboardStats.js';

const root=path.resolve(import.meta.dirname,'..');
// Synthetic demo business (no real data): tools/fixtures/business/{data,backups/month-close,exports}.
const fixtureRoot=path.join(root,'tools/fixtures/business');
const livePath=path.join(fixtureRoot,'data/stockpilot.json');
const liveBytes=fs.readFileSync(livePath);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const collections=['agents','accounts','companies','products','productMaster','todaySales','salesHistory','ledger','stockMovements','refunds','monthCloseArchive'];
const emptyDb=()=>({meta:{version:1,createdAt:new Date().toISOString(),lastBackupDate:null},...Object.fromEntries(collections.map(k=>[k,[]]))});
function environment(t) {
  fs.mkdirSync(path.join(root,'tmp'),{recursive:true});
  const dir=fs.mkdtempSync(path.join(root,'tmp/complete-reset-test-'));
  const paths={root:dir,dbFile:path.join(dir,'data/stockpilot.json'),backupDir:path.join(dir,'backups')};
  fs.mkdirSync(path.dirname(paths.dbFile),{recursive:true});
  // Complete business copy, including passive external history files.
  for(const relative of ['backups/month-close','exports']) if(fs.existsSync(path.join(fixtureRoot,relative))) fs.cpSync(path.join(fixtureRoot,relative),path.join(dir,relative),{recursive:true});
  const db=JSON.parse(liveBytes);
  if(!db.salesHistory.length) db.salesHistory.push({id:'OLD-HISTORY',orderId:'OLD-ORDER',companyId:db.companies[0].id});
  db.businessSettings={name:'OLD-PRIVATE-BUSINESS',nested:{companyId:db.companies[0].id}};
  db.unknownFutureHistory=[{privateData:'OLD-PRIVATE-BUSINESS'}];
  const original=Buffer.from(JSON.stringify(db,null,2));
  fs.writeFileSync(paths.dbFile,original);
  t.after(()=>assert(fs.readFileSync(livePath).equals(liveBytes),'Live database was changed'));
  return {dir,paths,original,db,service:io=>createCompleteReset({paths,emptyDb,io})};
}
const confirm=service=>({...service.prepare(),confirmation:'RESET'});

test('reset verifies a byte-exact full backup then replaces all business fields with fresh schema',t=>{
  const env=environment(t),service=env.service();
  const diskFiles=fs.readdirSync(path.join(env.dir,'exports'));
  const response=service.reset(confirm(service));
  const backup=fs.readFileSync(path.join(env.dir,response.backup));
  assert(backup.equals(env.original));assert.equal(response.sha256,sha(env.original));
  const clean=JSON.parse(fs.readFileSync(env.paths.dbFile));
  assert.deepEqual(Object.keys(clean).sort(),Object.keys(emptyDb()).sort());
  for(const key of collections) assert.deepEqual(clean[key],[]);
  assert.equal(clean.meta.lastBackupDate,null);
  assert(!JSON.stringify(clean).includes('OLD-PRIVATE-BUSINESS'));
  for(const c of env.db.companies) assert(!JSON.stringify(clean).includes(c.id));
  assert.deepEqual(fs.readdirSync(path.join(env.dir,'exports')),diskFiles);
  assert(fs.existsSync(path.join(env.dir,env.db.monthCloseArchive[0].file)));
  assert.deepEqual(response.database,clean);
});

test('backup write failure aborts with original bytes intact',t=>{
  const env=environment(t);
  const service=env.service({...fs,writeFileSync:()=>{throw Error('Injected backup write failure');}});
  assert.throws(()=>service.reset(confirm(service)),/backup write failure/);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
});

test('backup read-back verification failure aborts with original bytes intact',t=>{
  const env=environment(t);
  const service=env.service({...fs,readFileSync:(file,...args)=>String(file).includes('stockpilot-before-reset-') ? Buffer.from('{"corrupted":true}') : fs.readFileSync(file,...args)});
  assert.throws(()=>service.reset(confirm(service)),/verification/i);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
});

test('final reset persistence failure leaves original bytes and verified safety backup intact',t=>{
  const env=environment(t);
  const service=env.service({...fs,renameSync:(from,to)=>{if(to===env.paths.dbFile) throw Error('Injected persistence failure');return fs.renameSync(from,to);}});
  assert.throws(()=>service.reset(confirm(service)),/persistence failure/);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
  const backups=fs.readdirSync(path.join(env.paths.backupDir,'business-reset')).filter(f=>f.endsWith('.json'));
  assert.equal(backups.length,1);
  assert(fs.readFileSync(path.join(env.paths.backupDir,'business-reset',backups[0])).equals(env.original));
  assert.deepEqual(fs.readdirSync(path.dirname(env.paths.dbFile)),['stockpilot.json']);
});

test('published backup is read and verified again before the active database can be replaced',t=>{
  const env=environment(t);
  const service=env.service({...fs,readFileSync:(file,...args)=>String(file).includes('stockpilot-before-reset-')&&String(file).endsWith('.json') ? Buffer.from('{"badPublishedCopy":true}') : fs.readFileSync(file,...args)});
  assert.throws(()=>service.reset(confirm(service)),/Published full backup verification failed/);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
});

test('typed confirmation, single-use tokens and changed-data checks prevent accidental or repeated resets',t=>{
  const env=environment(t),service=env.service(),first=service.prepare(),second=service.prepare();
  assert.throws(()=>service.reset({...first,confirmation:'reset'}),/RESET/);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
  service.reset({...first,confirmation:'RESET'});
  const clean=fs.readFileSync(env.paths.dbFile);
  assert.throws(()=>service.reset({...first,confirmation:'RESET'}),/confirmation/i);
  assert.throws(()=>service.reset({...second,confirmation:'RESET'}),/confirmation/i);
  assert(fs.readFileSync(env.paths.dbFile).equals(clean));
  assert.equal(fs.readdirSync(path.join(env.paths.backupDir,'business-reset')).length,1);
  const next=service.prepare();fs.writeFileSync(env.paths.dbFile,env.original);
  assert.throws(()=>service.reset({...next,confirmation:'RESET'}),/changed/i);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
});

test('changes during backup are detected before commit and never overwritten',t=>{
  const env=environment(t),changed=Buffer.from(JSON.stringify({...env.db,externalChange:true}));
  const service=env.service({...fs,renameSync:(from,to)=>{
    fs.renameSync(from,to);
    if(String(to).includes('stockpilot-before-reset-')) fs.writeFileSync(env.paths.dbFile,changed);
  }});
  assert.throws(()=>service.reset(confirm(service)),/changed/i);
  assert(fs.readFileSync(env.paths.dbFile).equals(changed));
});

test('expired confirmation and malformed database are rejected without writes',t=>{
  const env=environment(t);let instant=new Date('2026-09-23T10:00:00Z');
  const service=createCompleteReset({paths:env.paths,emptyDb,now:()=>instant});
  const request=confirm(service);instant=new Date('2026-09-23T11:00:00Z');
  assert.throws(()=>service.reset(request),/expired|confirmation/i);
  assert(fs.readFileSync(env.paths.dbFile).equals(env.original));
  fs.writeFileSync(env.paths.dbFile,'{broken');
  assert.throws(()=>service.prepare());assert.equal(fs.readFileSync(env.paths.dbFile,'utf8'),'{broken');
});

test('isolated HTTP reset then entirely new company/product/agent/mapping/sale/report/export works',async t=>{
  const env=environment(t);
  fs.cpSync(path.join(root,'server'),path.join(env.dir,'server'),{recursive:true});
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,[path.join(env.dir,'server/index.mjs')],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null) await new Promise(r=>{child.once('exit',r);child.kill();});});
  const request=(route,method='GET',body)=>fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const ok=async(...args)=>{const r=await request(...args);assert.equal(r.status,200,await r.clone().text());return r.json();};
  let ready=false;
  for(let i=0;i<100;i++){try{ready=(await request('/server-info')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}
  assert(ready);
  const before=fs.readFileSync(env.paths.dbFile);
  const confirmation=await ok('/business-reset/prepare','POST',{});
  assert(fs.readFileSync(env.paths.dbFile).equals(before));
  const requests=await Promise.all([request('/business-reset','POST',{token:confirmation.token,confirmation:'RESET'}),request('/business-reset','POST',{token:confirmation.token,confirmation:'RESET'})]);
  assert.deepEqual(requests.map(r=>r.status).sort(),[200,409]);
  const result=await requests.find(r=>r.status===200).json();
  assert(fs.readFileSync(path.join(env.dir,result.backup)).equals(before));
  const clean=await ok('/state');
  for(const key of collections) assert.deepEqual(clean[key],[]);
  assert(!('correctionLog' in clean));assert(!('undoLog' in clean));assert(!('businessSettings' in clean));
  const company=await ok('/companies','POST',{name:'TEST NEW COMPANY'});
  const product=await ok('/products','POST',{sku:'NEW-PRODUCT',name:'New Product',costPrice:10,stock:5});
  const agent=await ok('/agents','POST',{name:'NEW AGENT',companyId:company.id});
  const mapping=await ok('/product-master','POST',{companyId:company.id,marketplace:'Amazon',code:product.sku,sku:'NEW-SKU',name:product.name});
  assert.equal(mapping.companyId,company.id);
  const state=await ok('/state'),account=state.accounts.find(a=>a.agentId===agent.id&&a.marketplace==='Amazon');
  assert.equal(state.accounts.length,3);assert.equal(state.companies.length,1);
  await ok('/sales','POST',[{agentId:agent.id,accountId:account.id,productId:product.id,qty:1,saleAmount:25,source:'manual',orderId:'OLD-ORDER'}]);
  const sold=await ok('/state');
  assert.equal(dashboardStats(sold,sold.todaySales[0].date.slice(0,7)).totals.sales,25);
  for(const route of ['/products/export-backup',`/product-master/export-backup?companyId=${company.id}`,'/product-master/template?companyId='+company.id+'&marketplace=Amazon','/products/import-template']) {
    const r=await request(route);assert.equal(r.status,200);assert(XLSX.read(Buffer.from(await r.arrayBuffer()),{type:'buffer'}).SheetNames.length);
  }
  assert.deepEqual((await ok('/month-close')).archives,[]);
  const closeDay=await request('/close-day','POST');assert.equal(closeDay.status,200);await closeDay.arrayBuffer();
  assert.equal((await ok('/state')).salesHistory.length,1);
  const month=await ok('/month-close','POST',{});assert.equal(month.salesArchived,1);
  assert.equal((await ok('/state')).salesHistory.length,0);
  console.log(`Complete reset/fresh-start tested only in ${env.dir}`);
});
