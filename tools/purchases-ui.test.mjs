// Real React DOM/component tests; only PDF I/O and backend APIs are substituted.
// Test dependency: npm install --prefix tmp/selection-component-tests --no-save --package-lock=false jsdom
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
console.info=()=>{};
console.debug=()=>{};

const project=resolve(import.meta.dirname,'..');
mkdirSync(join(project,'tmp'),{recursive:true});
const compiled=mkdtempSync(join(project,'tmp','purchases-ui-'));
for(const file of readdirSync(join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=readFileSync(join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api = globalThis.__salesTest.api;';
  if(file==='bankStatementFile.js') code='export const statementInput=(...args)=>globalThis.__statementInput(...args);';
  if(file==='pdf.js') code='export const fileToPdfPages = (...args)=>globalThis.__salesTest.pdf(...args); export const fileToImageDataUrls=()=>{throw Error("unexpected image fallback")};';
  if(file==='App.jsx') code+='\nexport {ReportsPage};';
  code=code.replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name.replace(/\.(js|jsx)$/,'')}.mjs${q}`)
    .replace(/from (["'])react\1/g,`from '${pathToFileURL(join(project,'client/node_modules/react/index.js')).href}'`);
  const result=await transform(code,{loader:file.endsWith('.jsx')?'jsx':'js',format:'esm'});
  writeFileSync(join(compiled,file.replace(/\.(js|jsx)$/,'.mjs')),result.code);
}
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5173'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('../client/node_modules/react/index.js');
const {createRoot}=await import('../client/node_modules/react-dom/client.js');
const {act}=React;
globalThis.__salesTest={api:{}};
const {default:Purchases}=await import(pathToFileURL(join(compiled,'Purchases.mjs')));
globalThis.FileReader=dom.window.FileReader;globalThis.localStorage=dom.window.localStorage;window.confirm=()=>true;

const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
const field=text=>[...document.querySelectorAll('label')].find(l=>l.firstChild?.textContent===text)?.querySelector('input,select');
const change=async(input,value)=>{assert.ok(input);await act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
const click=async(el)=>{assert.ok(el);await act(async()=>el.click());};
const fixture=()=>({products:[{id:'product',sku:'CODE',name:'Existing Product',costPrice:10,stock:3,lowStockLevel:1,image:'data:image/png;base64,aA=='}],suppliers:[{id:'supplier',name:'Supplier',phone:'123',address:'Road',gstin:''}],purchases:[{id:'purchase',date:'2026-10-12',supplierId:'supplier',supplierName:'Supplier',invoiceNumber:'ORIGINAL',lines:[{id:'line',productId:'product',sku:'CODE',productName:'Existing Product',qty:5,unitCost:10,unitCostCents:1000,totalCost:50,totalCents:5000}]}],purchaseReturns:[{id:'returned',lineId:'line',qty:1}]});
async function mount(t,state=fixture()){
 const before=JSON.stringify(state),calls={reload:0,notify:[]},root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(Purchases,{state,reload:async()=>{calls.reload++;},notify:message=>calls.notify.push(message)})));
 t.after(async()=>{await act(async()=>root.unmount());assert.equal(JSON.stringify(state),before);});return calls;
}
test('Purchase entry prepopulates existing products, calculates totals, confirms receiving and suppresses double submit',async t=>{
 let received,resolve;globalThis.__salesTest.api.receivePurchase=(requestId,invoice)=>{received={requestId,invoice};return new Promise(r=>resolve=r);};
 const calls=await mount(t);await change(field('Warehouse Product'),'product');assert.equal(field('Warehouse Product Code').value,'CODE');assert.equal(field('Product Name').value,'Existing Product');assert.equal(field('Unit Purchase Cost').value,'10');assert.equal(field('Product Name').readOnly,true);assert.equal(document.querySelector('.thumb img').getAttribute('src'),fixture().products[0].image);
 await change(field('Supplier Name'),'Supplier');await change(field('Invoice Number'),'NEW');await change(field('Quantity'),'2');await change(field('Unit Purchase Cost'),'12.50');assert.ok(document.body.textContent.includes('25.00'));
 await click(button('Add Another Product'));assert.equal(document.querySelectorAll('.purchase-line').length,2);await click([...document.querySelectorAll('button')].filter(b=>b.textContent==='Remove Line').at(-1));assert.equal(document.querySelectorAll('.purchase-line').length,1);
 await click(button('Receive Purchase'));assert.equal(received.invoice.lines[0].qty,'2');assert.equal(received.invoice.lines[0].sku,'CODE');assert.ok(received.requestId.length>16);assert.ok(document.querySelector('fieldset').disabled);
 await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));const requestId=received.requestId;
 await act(async()=>resolve({replayed:false}));assert.equal(calls.reload,1);assert.equal(field('Invoice Number').value,'');assert.equal(received.requestId,requestId);
});
test('History filters, supplier editing and purchase returns are independent of sales APIs and read-only state',async t=>{
 let savedSupplier,returned;globalThis.__salesTest.api.saveSupplier=async(body,id)=>{savedSupplier={body,id};};globalThis.__salesTest.api.returnPurchase=async body=>{returned=body;return {replayed:false};};
 const calls=await mount(t);await click(button('Purchase History'));await change(field('Period'),'monthly');await change(field('Month / Year'),'2026-10');assert.ok(document.querySelector('table').textContent.includes('ORIGINAL'));assert.ok(document.querySelector('table').textContent.includes('Partially returned'));
 await change(field('Product Search'),'NO MATCH');assert.ok(document.body.textContent.includes('No purchases in this period.'));await change(field('Product Search'),'code');await change(field('Period'),'custom');await change(field('From Date'),'2026-10-12');await change(field('To Date'),'2026-10-12');assert.ok(document.querySelector('table').textContent.includes('ORIGINAL'));assert.equal(calls.reload,0);
 await click(button('Supplier Management'));await click(button('Edit Supplier'));await change(field('Supplier Name'),'Renamed');await click(button('Save Supplier'));assert.equal(savedSupplier.id,'supplier');assert.equal(savedSupplier.body.name,'Renamed');
 await click(button('Purchase Returns'));await change(field('Original Purchase Line'),'line');assert.ok(document.body.textContent.includes('Currently eligible: 3 units'));await change(field('Return Quantity'),'2');await click(button('Record Purchase Return'));assert.equal(returned.lineId,'line');assert.equal(returned.qty,'2');assert.ok(returned.requestId.length>16);assert.equal(calls.reload,2);
});
test('Bulk import displays validation errors and keeps importing disabled until the entire file is valid',async t=>{
 let validations=0;globalThis.__salesTest.api.previewPurchases=async()=>{validations++;return {valid:false,rows:[{row:2,date:'2026-10-12',supplierName:'Supplier',invoiceNumber:'BAD',sku:'X',name:'X',qty:0,unitCost:1,error:'Quantity must be a whole number of 1 or more.'}],summary:{invoices:1,products:1,quantity:0,totalCents:0,invalidRows:1}};};
 await mount(t);await click(button('Bulk Purchase Import'));const input=document.querySelector('input[type=file]');await act(async()=>{Object.defineProperty(input,'files',{value:[new dom.window.File(['workbook'],'Purchase.xlsx')],configurable:true});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,30));});
 assert.equal(validations,1);assert.ok(button('Import Purchases').disabled);assert.ok(button('Download Error Report'));assert.ok(document.querySelector('tr.is-err').textContent.includes('Quantity must'));
});

test('App places Purchases above Warehouse and applies responsive shell only to Purchases',async t=>{
 const {default:App}=await import(pathToFileURL(join(compiled,'App.mjs')));
 const state={...fixture(),companies:[{id:"company",name:"Company"}],agents:[],accounts:[],productMaster:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[]};
 globalThis.__salesTest.api.state=async()=>state;globalThis.__salesTest.api.health=async()=>({ollama:{ok:false}});
 const before=JSON.stringify(state),root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(App)));t.after(async()=>{await act(async()=>root.unmount());assert.equal(JSON.stringify(state),before);});
 const nav=[...document.querySelectorAll('nav button')].map(b=>b.textContent);assert.equal(nav.indexOf('Purchases')+1,nav.indexOf('Warehouse'));
 await click(button('Purchases'));assert.ok(document.querySelector('.app').classList.contains('app-purchases'));assert.ok(document.querySelector('form'));
 await click(button('Warehouse'));assert.ok(!document.querySelector('.app').classList.contains('app-purchases'));assert.ok(document.querySelector('[aria-label="Search warehouse products"]'));assert.equal(document.querySelector('main button'),null);
});
