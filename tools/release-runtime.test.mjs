import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {inspectLocalAi,startLocalAi,modelRecommendation,localOllamaUrl,findLocalOllama,confirmLocalAiRequest} from '../server/localAi.mjs';
const require=createRequire(import.meta.url);
const {verifyManifest,verifyNativeInfo,verifyInstaller}=require('../electron/updateTrust.cjs');
const {createUpdateManager}=require('../electron/updateManager.cjs');
const {backupBeforeUpdate}=require('../electron/updateBackup.cjs');
const root=path.resolve(import.meta.dirname,'..');
const temp=()=>fs.mkdtempSync(path.join(root,'tmp/release-test-'));
test('service start is restricted to the trusted local Settings origin',()=>{
 confirmLocalAiRequest('http://127.0.0.1:8787',8787);
 confirmLocalAiRequest('http://127.0.0.1:5199',8791,'http://127.0.0.1:5199');
 for(const origin of [undefined,'null','https://evil.example','http://127.0.0.1:8787.evil.example','http://192.168.1.10:8787'])assert.throws(()=>confirmLocalAiRequest(origin,8787));
 assert.throws(()=>confirmLocalAiRequest('https://evil.example',8787,'https://evil.example'));
});
const pair=crypto.generateKeyPairSync('ed25519');
function envelope(bytes=Buffer.from('synthetic installer fixture')){
 const payload={version:'1.1.1',url:'https://github.com/infobridgeindiaofficial-rgb/sellquanta/releases/download/v1.1.1/SellQuanta-Setup-1.1.1.exe',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sha512:crypto.createHash('sha512').update(bytes).digest('base64'),releaseNotes:'Synthetic update only',releaseDate:new Date().toISOString()};
 return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),pair.privateKey).toString('base64')};
}
test('signed update metadata rejects tampering, wrong keys, downgrade, external URLs, malformed packages and native feed mismatch',()=>{
 const e=envelope(),p=verifyManifest(e,pair.publicKey,'1.1.0');assert.equal(p.version,'1.1.1');
 assert.throws(()=>verifyManifest({...e,payload:{...e.payload,version:'2.0.0'}},pair.publicKey,'1.1.0'),/signature/);
 assert.throws(()=>verifyManifest(e,crypto.generateKeyPairSync('ed25519').publicKey,'1.1.0'),/signature/);
 assert.throws(()=>verifyManifest(e,pair.publicKey,'1.2.0'),/older/);
 for(const changes of [{url:'https://evil.example/package.exe'},{size:-1},{sha512:'bad'},{sha256:'bad'},{version:'1.1.1-beta'},{releaseDate:'bad'}]){const payload={...e.payload,...changes};const signed={payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),pair.privateKey).toString('base64')};assert.throws(()=>verifyManifest(signed,pair.publicKey,'1.1.0'));}
 const info={version:p.version,files:[{url:p.url,sha512:p.sha512,size:p.size}]};verifyNativeInfo(info,p);
 assert.throws(()=>verifyNativeInfo({...info,files:[{...info.files[0],sha512:'bad'}]},p));assert.throws(()=>verifyNativeInfo({...info,packages:{}},p));
});
test('installer integrity is checked before install and after cached-file tampering',async()=>{
 const bytes=Buffer.from('fixture'),e=envelope(bytes),file=path.join(temp(),'installer.exe');fs.writeFileSync(file,bytes);await verifyInstaller(file,e.payload);fs.writeFileSync(file,Buffer.from('changed'));await assert.rejects(verifyInstaller(file,e.payload),/checksum/);fs.appendFileSync(file,'x');await assert.rejects(verifyInstaller(file,e.payload),/size/);
});
test('update startup/periodic checks, explicit download/install, no quit auto-install, errors and trusted state',async()=>{
 const bytes=Buffer.from('fixture'),e=envelope(bytes),file=path.join(temp(),'installer.exe');fs.writeFileSync(file,bytes);
 const updater=new EventEmitter();let checks=0,downloads=0,installs=0;
 updater.checkForUpdates=async()=>{checks++;return {updateInfo:{version:e.payload.version,files:[{url:e.payload.url,sha512:e.payload.sha512,size:e.payload.size}]}};};updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:50});return [file];};updater.quitAndInstall=()=>{installs++;};
 let confirm=false;const manager=createUpdateManager({updater,publicKey:pair.publicKey,currentVersion:'1.1.0',fetchManifest:async()=>e,install:async proceed=>{if(confirm)proceed();},intervalMs:20});
 assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);assert.equal(updater.disableWebInstaller,true);
 await assert.rejects(manager.download(),/Check/);await assert.rejects(manager.apply(),/Download/);
 manager.start();await new Promise(r=>setTimeout(r,65));manager.stop();assert.ok(checks>=2);assert.equal(downloads,0);assert.equal(installs,0);
 await manager.download();assert.equal(manager.getState().status,'downloaded');assert.equal(downloads,1);await manager.apply();assert.equal(installs,0);confirm=true;await manager.apply();assert.equal(installs,1);
 updater.quitAndInstall=()=>updater.emit('error',Error('Installer fixture refused to start'));await assert.rejects(manager.apply(),/refused to start/);assert.equal(manager.getState().status,'error');
 await manager.check();await manager.download();fs.writeFileSync(file,'tampered');await assert.rejects(manager.apply());assert.equal(installs,1);
 const bad=createUpdateManager({updater,publicKey:pair.publicKey,currentVersion:'1.1.0',fetchManifest:async()=>{throw Error('offline');},install:()=>assert.fail('must not install')});await bad.check();assert.equal(bad.getState().status,'error');assert.equal(bad.getState().error,'offline');
});
test('pre-update JSON backup preserves every collection and refuses unreadable data',()=>{
 const dir=temp();fs.mkdirSync(path.join(dir,'data'));const file=path.join(dir,'data/stockpilot.json'),bytes=Buffer.from(JSON.stringify({products:[],agents:[],todaySales:[{id:'s',saleAmount:10}],purchases:[{id:'p'}],bankSettlements:[{id:'b',amountCents:100}],bankingAudit:[{id:'a'}],ledger:[{id:'w'}],settings:{test:true}}));fs.writeFileSync(file,bytes);const backup=backupBeforeUpdate(dir,'1.1.0');assert.ok(fs.readFileSync(backup).equals(bytes));assert.ok(fs.readFileSync(file).equals(bytes));fs.writeFileSync(file,'bad');assert.throws(()=>backupBeforeUpdate(dir,'1.1.0'));assert.equal(fs.readFileSync(file,'utf8'),'bad');
});
test('Ollama installed/not installed/running/vision model status and RAM guidance never starts a service',async()=>{
 let calls=0;const down=async()=>{calls++;throw Error('offline');};const absent=await inspectLocalAi({model:'qwen2.5vl:3b',fetchImpl:down,find:()=>null,ramBytes:4*1024**3});assert.equal(absent.status,'Not Installed');assert.equal(absent.recommendation.model,null);
 const installed=await inspectLocalAi({model:'qwen2.5vl:3b',fetchImpl:down,find:()=>'/installed/ollama'});assert.equal(installed.status,'Installed / Not Running');
 const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('/api/tags')?{models:[{name:'qwen2.5vl:3b'}]}:url.endsWith('/api/show')?{capabilities:['vision']}:{version:'test'}});
 const running=await inspectLocalAi({model:'qwen2.5vl:3b',fetchImpl,find:()=>null});assert.equal(running.status,'Installed / Running');assert.equal(running.modelInstalled,true);assert.equal(running.visionSupported,true);
 assert.equal(modelRecommendation(32*1024**3).optionalLargerModel,'qwen2.5vl:7b');assert.equal(modelRecommendation(16*1024**3).model,'qwen2.5vl:3b');
 assert.equal(localOllamaUrl('http://localhost:11434'),'http://127.0.0.1:11434');for(const u of ['http://0.0.0.0:11434','http://192.168.1.2:11434','https://evil.example','http://user:password@localhost:11434'])assert.throws(()=>localOllamaUrl(u));assert.equal(findLocalOllama({PATH:'/test'},()=>false),null);
});
test('Ollama start requires consent, avoids reinstall/restarting a running service and forces loopback',async()=>{
 let spawns=0,env;const child=new EventEmitter();const spawnImpl=(_exe,args,opts)=>{spawns++;assert.deepEqual(args,['serve']);env=opts.env;return child;};const down=async()=>{throw Error('offline');};
 await assert.rejects(startLocalAi({confirm:false,spawnImpl}),/Confirm/);await assert.rejects(startLocalAi({confirm:true,fetchImpl:down,find:()=>null,spawnImpl}),/not installed/);assert.equal(spawns,0);
 const up=async()=>({ok:true,json:async()=>({models:[],version:'test'})});const already=await startLocalAi({confirm:true,fetchImpl:up,find:()=>'/installed',spawnImpl});assert.equal(already.started,false);assert.equal(spawns,0);
 const started=await startLocalAi({confirm:true,fetchImpl:down,find:()=>'/installed',spawnImpl});assert.equal(started.started,true);assert.equal(spawns,1);assert.equal(env.OLLAMA_HOST,'127.0.0.1:11434');child.emit('exit',0);
});
