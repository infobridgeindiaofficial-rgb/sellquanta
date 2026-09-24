import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/export-components-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__exportApi;';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{}; export const fileToImageDataUrls=()=>{};';
  if(file==='App.jsx') code+='\nexport {Warehouse,ProductMaster};';
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
const {Warehouse,ProductMaster}=await import(pathToFileURL(path.join(compiled,'App.mjs')));
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
test('Warehouse export button downloads a single workbook and recovers from request failure',async t=>{
  let calls=0;
  globalThis.__exportApi.exportWarehouseBackup=async()=>{calls++;return {blob:new Blob(),name:'StockPilot_Warehouse_Backup_2026-09-23.xlsx'};};
  const view=await mount(t,Warehouse);
  await click(button('Export Warehouse Backup'));
  assert.equal(calls,1);assert.deepEqual(view.downloads,['StockPilot_Warehouse_Backup_2026-09-23.xlsx']);
  assert(button('Download Excel Template'));assert(button('Upload Excel'));
  globalThis.__exportApi.exportWarehouseBackup=async()=>{throw Error('Export failed');};
  await click(button('Export Warehouse Backup'));
  assert.deepEqual(view.errors,['Export failed']);assert.equal(button('Export Warehouse Backup').disabled,false);
});
test('Company export requires only selected company, uses latest selection, and downloads one workbook',async t=>{
  const calls=[];
  globalThis.__exportApi.exportCompanyBackup=async id=>{calls.push(id);return {blob:new Blob(),name:`${id}.xlsx`};};
  const view=await mount(t,ProductMaster);
  assert.equal(button('Export Company Backup').disabled,true);
  const company=document.querySelector('select');
  for(const id of ['c1','c2']) {
    await act(async()=>{company.value=id;company.dispatchEvent(new window.Event('change',{bubbles:true}));});
    assert.equal(document.querySelectorAll('select')[1].value,'');
    assert.equal(button('Export Company Backup').disabled,false);
    await click(button('Export Company Backup'));
  }
  assert.deepEqual(calls,['c1','c2']);assert.deepEqual(view.downloads,['c1.xlsx','c2.xlsx']);
});

test('export API uses GET with encoded company ID and the backend filename',async t=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(...args)=>{calls.push(args);return new Response('xlsx',{headers:{'Content-Disposition':'attachment; filename="Company_Backup.xlsx"'}});};
  t.after(()=>{globalThis.fetch=original;});
  const {api}=await import('../client/src/api.js');
  assert.equal((await api.exportCompanyBackup('company & one')).name,'Company_Backup.xlsx');
  await api.exportWarehouseBackup();
  assert.deepEqual(calls,[['http://127.0.0.1:8787/api/product-master/export-backup?companyId=company%20%26%20one'],['http://127.0.0.1:8787/api/products/export-backup']]);
});
