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
  if(file==='bankStatementFile.js') code='export const statementInput=(...args)=>globalThis.__statementInput(...args);';
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
async function mount(t,Component,viewState=state) {
  const root=createRoot(document.getElementById('root')),downloads=[],errors=[];
  const before=JSON.stringify(viewState);
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  await act(async()=>root.render(React.createElement(Component,{state:viewState,reload:()=>assert.fail('Export must not reload or save records'),notify:e=>errors.push(e)})));
  t.after(async()=>{await act(async()=>root.unmount());localStorage.clear();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;assert.equal(JSON.stringify(viewState),before);});
  return {downloads,errors};
}
test('Warehouse is read-only, preserves images and summaries, and searches active stock by name or code',async t=>{
  let calls=0;
  for(const method of ['exportWarehouseBackup','addProduct','updateProduct','removeProduct','setProductImage','adjustStock','productImportTemplate','previewProductImport','importProducts']) globalThis.__exportApi[method]=()=>{calls++;assert.fail('Warehouse must not call management or export APIs');};
  const fixture={...state,products:[
    {id:'p1',sku:'CODE-1',name:'Blue Shirt',costPrice:100,stock:8,lowStockLevel:5,image:'data:image/png;base64,aA=='},
    {id:'p2',sku:'CODE-2',name:'Red Shirt',costPrice:50,stock:2,lowStockLevel:3},
    {id:'p3',sku:'CODE-3',name:'Hat',costPrice:20,stock:0},
    {id:'archived',sku:'OLD',name:'Archived Product',costPrice:500,stock:99,active:false}
  ],stockMovements:[{id:'movement',productId:'p1',qty:8}]};
  await mount(t,Warehouse,fixture);
  const metric=label=>[...document.querySelectorAll('.stat')].find(el=>el.querySelector('.stat-label')?.textContent===label).querySelector('.stat-value').textContent;
  assert.equal(metric('Total Products'),'3');assert.equal(metric('Total Stock Units'),'10');assert.ok(metric('Current Stock Value').includes('900'));
  assert.equal(document.querySelector('tbody').rows.length,3);
  assert.equal(document.querySelector('tbody img').getAttribute('src'),fixture.products[0].image);
  assert.ok(document.body.textContent.includes('Low stock'));assert.ok(document.body.textContent.includes('Out of stock'));
  assert.ok(!document.body.textContent.includes('Archived Product'));
  for(const text of ['Manual Product Entry','Bulk Import Products','Stock In / Adjustment','Add Product','Update Product','Upload Excel','Download Excel Template','Export Warehouse Backup','Actions'])assert.ok(!document.body.textContent.includes(text));
  assert.equal(document.querySelectorAll('button,input[type=file],input[type=number],select').length,0);
  const search=document.querySelector('[aria-label="Search warehouse products"]');
  const change=async value=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(search,value);search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
  await change('  bLuE  ');assert.equal(document.querySelector('tbody').rows.length,1);assert.ok(document.querySelector('tbody').textContent.includes('Blue Shirt'));
  assert.equal(metric('Total Stock Units'),'10');assert.ok(metric('Current Stock Value').includes('900'));
  await change('code-2');assert.ok(document.querySelector('tbody').textContent.includes('Red Shirt'));
  await change('no match');assert.ok(document.querySelector('tbody').textContent.includes('No products match your search.'));
  await change('');assert.equal(document.querySelector('tbody').rows.length,3);assert.equal(calls,0);
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
