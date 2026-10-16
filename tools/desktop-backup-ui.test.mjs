import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'electron/main.cjs'));
function shell(response){
 const temp=fs.mkdtempSync(path.join(root,'tmp/electron-shell-')),session=new EventEmitter(),app=new EventEmitter();
 Object.assign(app,{isPackaged:true,setName(){},setAppUserModelId(){},getPath:()=>temp,requestSingleInstanceLock:()=>false,quit(){}});
 session.setPermissionRequestHandler=()=>{};
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>'';this.messages=[];this.webContents.executeJavaScript=code=>{this.messages.push(code);return Promise.resolve();};}isDestroyed(){return false;}setAppDetails(details){this.details=details;}loadFile(){return Promise.resolve();}}
 const module={exports:{}},context={require:name=>name==='electron'?{app,BrowserWindow:Window,Menu:{},shell:{},session:{defaultSession:session},dialog:{},Notification:{}}:name==='node:child_process'?{spawn:()=>assert.fail('Must not start/kill a process for an occupied port'),execFile:()=>assert.fail('Must not kill another process')}:name==='node:fs'?{...fs,existsSync:p=>p===path.join(root,'client/dist/index.html')||fs.existsSync(p)}:require(name),__dirname:path.join(root,'electron'),process,console,URL,fetch:response?async url=>({ok:true,status:200,text:async()=>url.includes('11434')?'{}':response}):fetch,AbortSignal,setTimeout,clearTimeout,module};
 vm.runInNewContext(fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8')+'\nmodule.exports={hardenSession,createWindow,startInner,window:()=>win};',context);
 return {...module.exports,session,temp};
}
test('manual backup downloads offer Windows Save dialog; packaged window uses explicit SellQuanta taskbar identity',async()=>{
 const s=shell();s.hardenSession();const item=new EventEmitter();let options;
 Object.assign(item,{getURL:()=> 'http://127.0.0.1:8787/api/backup/manual/stockpilot-manual-20261016-120000.json',getFilename:()=> 'stockpilot-manual-20261016-120000.json',setSaveDialogOptions:value=>{options=value;},setSavePath:()=>assert.fail('Manual backup must offer a choice'),getSavePath:()=>''});
 s.session.emit('will-download',{},item);assert.equal(options.title,'Save SellQuanta Backup Copy');assert.ok(options.defaultPath.startsWith(s.temp));assert.equal(options.filters[0].extensions[0],'json');assert.ok(options.properties.includes('showOverwriteConfirmation'));
 await s.createWindow();assert.equal(s.window().details.appId,'com.sellquanta.desktop');assert.equal(s.window().details.appIconPath,path.join(root,'tools/SellQuanta.ico'));assert.equal(s.window().options.webPreferences.nodeIntegration,false);
});

test('desktop refuses unrelated or unowned localhost services without killing them',async()=>{
 for(const response of ['Other application',JSON.stringify({pid:76543,startedAt:'2026-10-16',dataFile:'C:/different/data/stockpilot.json'})]){
  const s=shell(response);await s.createWindow();await s.startInner();assert.ok(s.window().messages.some(m=>/Another program|already open in the browser/.test(m)));
 }
});
