import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url),location=require('../electron/dataLocation.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fixture=()=>({meta:{version:1},companies:[{id:'c',name:'Synthetic'}],agents:[{id:'a',name:'Synthetic',companyId:'c'}],accounts:[],products:[{id:'p',name:'Synthetic',stock:5}],productMaster:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],purchases:[{id:'p',date:'2026-01-01',totalCents:150000}],bankSettlements:[{id:'synthetic',amountCents:100}],bankingAudit:[{id:'audit'}],returnCharges:[],stockMovements:[],monthCloseArchive:[],settings:{synthetic:true},futureSchema:{preserve:true}});
async function server(t,dataRoot){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dataRoot,SELLQUANTA_SKIP_STARTUP_WRITES:'1',SELLQUANTA_CLIENT_DIST:path.join(root,'client/dist')},windowsHide:true,stdio:'ignore'});
 let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});};t.after(stop);
 const request=(url,post=false)=>fetch(`http://127.0.0.1:${port}${url}`,post?{method:'POST'}:{});
 let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/server-info')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}assert.ok(ready);return {request,stop};
}
test('manual backup verifies full bytes, absolute paths, unique names and download; restore/restart never changes source',async t=>{
 const dir=fs.mkdtempSync(path.join(root,'tmp/production-backup-'));fs.mkdirSync(path.join(dir,'data'));const file=path.join(dir,'data/stockpilot.json'),bytes=Buffer.from(JSON.stringify(fixture()));fs.writeFileSync(file,bytes);
 const api=await server(t,dir);
 const results=[];
 for(let i=0;i<2;i++){
  const response=await api.request('/api/backup',true);assert.equal(response.status,200);const info=await response.json();results.push(info);
  assert.equal(info.verified,true);assert.equal(path.isAbsolute(info.absolutePath),true);assert.equal(info.bytes,bytes.length);assert.equal(info.sha256,hash(bytes));assert.ok(fs.readFileSync(info.absolutePath).equals(bytes));
  const copy=await api.request('/api/backup/manual/'+path.basename(info.absolutePath));assert.equal(copy.status,200);assert.ok(Buffer.from(await copy.arrayBuffer()).equals(bytes));
 }
 assert.notEqual(results[0].absolutePath,results[1].absolutePath);assert.ok(fs.readFileSync(file).equals(bytes));
 const rejected=await api.request('/api/backup/manual/not-a-backup.json');assert.equal(rejected.status,400);
 const info=await(await api.request('/api/backup-info')).json();assert.equal(info.absolutePath,path.join(dir,'backups'));assert.equal(info.dataFile,file);
 await api.stop();
 const target=fs.mkdtempSync(path.join(root,'tmp/production-restore-'));
 const restored=location.importLegacy({root:dir,file:results[0].absolutePath},target);
 assert.ok(fs.readFileSync(restored.targetDb).equals(bytes));assert.ok(fs.readFileSync(restored.backupFile).equals(bytes));assert.throws(()=>location.importLegacy({root:dir,file},target),/already exists/);
 const reopened=await server(t,target);assert.equal((await reopened.request('/api/state')).status,200);await reopened.stop();assert.ok(fs.readFileSync(restored.targetDb).equals(bytes));
 assert.equal((await server(t,target)).request instanceof Function,true);assert.ok(fs.readFileSync(file).equals(bytes));
});
test('backup errors never return success or replace corrupt/missing data',async t=>{
 const dir=fs.mkdtempSync(path.join(root,'tmp/backup-failure-'));fs.mkdirSync(path.join(dir,'data'));const file=path.join(dir,'data/stockpilot.json');fs.writeFileSync(file,'corrupt synthetic JSON');
 const {request}=await server(t,dir);const response=await request('/api/backup',true);assert.equal(response.status,500);assert.ok((await response.json()).error);assert.equal(fs.readFileSync(file,'utf8'),'corrupt synthetic JSON');
 fs.writeFileSync(file,'{}');assert.equal((await request('/api/state')).status,500);assert.equal(fs.readFileSync(file,'utf8'),'{}');
 fs.writeFileSync(file,JSON.stringify(fixture()));fs.writeFileSync(path.join(dir,'backups/manual'),'synthetic obstacle');
 assert.equal((await request('/api/backup',true)).status,500);assert.deepEqual(JSON.parse(fs.readFileSync(file)),fixture());
});
test('packaging includes every relative backend runtime dependency and excludes business/test data',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),files=pkg.build.files,seen=new Set();
 function walk(file){file=path.resolve(file);if(seen.has(file))return;seen.add(file);assert.ok(fs.existsSync(file),file);if(!/\.(mjs|cjs|js)$/.test(file))return;
  const relative=path.relative(root,file).replaceAll('\\','/');assert.ok(relative.startsWith('server/')||files.includes(relative),relative);
  for(const match of fs.readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)['"](\.[^'"]+)['"]/g))walk(path.resolve(path.dirname(file),match[1]));
 }walk(path.join(root,'server/index.mjs'));
 assert.ok(!files.includes('client/src/**/*.js'));assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
 const ico=fs.readFileSync(path.join(root,'tools/SellQuanta.ico'));assert.equal(ico.readUInt16LE(2),1);assert.ok(ico.readUInt16LE(4)>0);
 assert.equal(location.productionDataRoot({getPath:()=>'/synthetic/appdata'}),path.join('/synthetic/appdata','SellQuanta Data'));
});

test('automatic backup retention remains 30 daily snapshots and never prunes manual backups',async()=>{
 const dir=fs.mkdtempSync(path.join(root,'tmp/backup-retention-'));fs.mkdirSync(path.join(dir,'data'));fs.mkdirSync(path.join(dir,'backups/manual'),{recursive:true});
 const bytes=JSON.stringify(fixture()),file=path.join(dir,'data/stockpilot.json');fs.writeFileSync(file,bytes);
 for(let i=1;i<=31;i++)fs.writeFileSync(path.join(dir,'backups',`stockpilot-2020-01-${String(i).padStart(2,'0')}.json`),bytes);
 const manual=path.join(dir,'backups/manual/kept.json');fs.writeFileSync(manual,bytes);
 const child=spawn(process.execPath,['--input-type=module','-e',"const m=await import('./server/store.mjs');const r=m.autoBackupOncePerDay();if(r.status!=='created')throw Error(JSON.stringify(r));"],{cwd:root,env:{...process.env,SELLQUANTA_DATA_ROOT:dir},windowsHide:true,stdio:'pipe'});
 let error='';child.stderr.on('data',b=>error+=b);const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0,error);
 assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(f=>/^stockpilot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).length,30);assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(fs.readFileSync(manual,'utf8'),bytes);
});
