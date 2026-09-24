import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/download-feedback-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__exportApi;';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{}; export const fileToImageDataUrls=()=>{};';
  if(file==='App.jsx') code+='\nexport {Warehouse,ProductMaster,CloseDay};';
  code=code.replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name.replace(/\.(js|jsx)$/,'')}.mjs${q}`)
    .replace(/from (["'])react\1/g,`from '${pathToFileURL(path.join(project,'client/node_modules/react/index.js')).href}'`);
  fs.writeFileSync(path.join(compiled,file.replace(/\.(js|jsx)$/,'.mjs')),(await transform(code,{loader:file.endsWith('.jsx')?'jsx':'js',format:'esm'})).code);
}
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5173'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;
globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('../client/node_modules/react/index.js');
const {act}=React;
const {createRoot}=await import('../client/node_modules/react-dom/client.js');
globalThis.__exportApi={};
const {Warehouse,ProductMaster,CloseDay}=await import(pathToFileURL(path.join(compiled,'App.mjs')));
const state={companies:[{id:'c1',name:'Company One'},{id:'c2',name:'Company Two'}],products:[],productMaster:[],stockMovements:[],todaySales:[],salesHistory:[],agents:[],accounts:[],ledger:[],refunds:[]};
// Download buttons briefly change their text (Downloading / Downloaded / Download failed); data-label keeps the name.
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text||b.dataset.label===text);
const click=async el=>{assert(el);await act(async()=>el.click());};
async function mount(t,Component) {
  const root=createRoot(document.getElementById('root')),downloads=[],errors=[];
  const before=JSON.stringify(state);
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  await act(async()=>root.render(React.createElement(Component,{state,reload:()=>assert.fail('Export must not reload or save records'),notify:e=>errors.push(e)})));
  t.after(async()=>{await act(async()=>root.unmount());localStorage.clear();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;assert.equal(JSON.stringify(state),before);});
  return {downloads,errors};
}
// Download buttons give visible feedback: label -> Downloading… -> Downloaded (≈2.5s) -> label; failures show
// "Download failed". The download itself (API call + anchor download with the backend filename) is unchanged.
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const byLabel=label=>[...document.querySelectorAll('button')].find(b=>b.dataset.label===label);
async function pickCompany(){
  const [company,market]=document.querySelectorAll('select');
  await act(async()=>{company.value='c1';company.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await act(async()=>{market.value='Amazon';market.dispatchEvent(new window.Event('change',{bubbles:true}));});
}

test('Product Master Download Excel Template: Downloading… then ✓ Downloaded, then back to its label',async t=>{
  const d=deferred();
  globalThis.__exportApi.productMasterTemplate=()=>d.promise;
  const view=await mount(t,ProductMaster);
  await pickCompany();
  const b=byLabel('Download Excel Template');
  assert.equal(b.textContent,'Download Excel Template');
  await act(async()=>{b.click();});
  assert.equal(b.textContent,'Downloading…');assert.equal(b.disabled,true);
  await act(async()=>{d.resolve({blob:new Blob(),name:'Company_One_Amazon_Product_Master.xlsx'});await d.promise;});
  assert.equal(b.textContent,'Downloaded');assert.equal(b.disabled,false);
  assert.ok(b.querySelector('svg'),'check icon shown');
  assert.deepEqual(view.downloads,['Company_One_Amazon_Product_Master.xlsx'],'same filename as before');
  await act(async()=>{await sleep(2700);});
  assert.equal(b.textContent,'Download Excel Template');
});

test('failed download shows "Download failed" (plus the existing message), then returns to its label',async t=>{
  globalThis.__exportApi.productMasterTemplate=async()=>{throw Error('Server not reachable');};
  const view=await mount(t,ProductMaster);
  await pickCompany();
  const b=byLabel('Download Excel Template');
  await act(async()=>{b.click();});
  await act(async()=>{await sleep(0);});
  assert.equal(b.textContent,'Download failed');assert.deepEqual(view.errors,['Server not reachable']);assert.deepEqual(view.downloads,[]);
  await act(async()=>{await sleep(3700);});
  assert.equal(b.textContent,'Download Excel Template');
});

test('all Warehouse and Product Master download buttons use the feedback pattern',async t=>{
  globalThis.__exportApi.exportWarehouseBackup=async()=>({blob:new Blob(),name:'W.xlsx'});
  globalThis.__exportApi.productImportTemplate=async()=>new Blob();
  const view=await mount(t,Warehouse);
  for(const label of ['Export Warehouse Backup','Download Excel Template']) {
    await act(async()=>{byLabel(label).click();});await act(async()=>{await sleep(0);});
    assert.equal(byLabel(label).textContent,'Downloaded',label);
  }
  assert.deepEqual(view.downloads,['W.xlsx','SellQuanta_Warehouse_Import_Template.xlsx']);
});

test('Close Day: cancelling the confirmation shows no feedback and downloads nothing',async t=>{
  const orig=window.confirm;window.confirm=()=>false;t.after(()=>{window.confirm=orig;});
  globalThis.__exportApi.closeDay=async()=>assert.fail('must not run when cancelled');
  const root=createRoot(document.getElementById('root'));
  const s={...state,todaySales:[{id:'s',qty:1,saleAmount:10}],monthCloseArchive:[]};
  globalThis.__exportApi.monthCloseList=async()=>({archives:[]});globalThis.__exportApi.backupInfo=async()=>({});
  await act(async()=>root.render(React.createElement(CloseDay,{state:s,reload:async()=>{},notify:()=>{},busy:false,setBusy:()=>{},onBusinessReset:()=>{}})));
  t.after(async()=>{await act(async()=>root.unmount());});
  const b=byLabel('Export Excel + Reset Daily Sales');
  await act(async()=>{b.click();});await act(async()=>{await sleep(0);});
  assert.equal(b.textContent,'Export Excel + Reset Daily Sales');
});
