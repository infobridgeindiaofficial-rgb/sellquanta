import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
import { parseStatement, buildPreview } from '../server/bankStatement.mjs';
import { statementPdfPages } from './fixtures/banking-statements.mjs';
import express from 'express';
import {registerBankStatementRoutes} from '../server/bankStatementRoutes.mjs';
import {createBankReceiptPersistence} from '../server/bankReceiptImport.mjs';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/purchase-ui-components-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__exportApi;';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{}; export const fileToImageDataUrls=()=>{};';
  if(file==='bankStatementFile.js') code='export const statementInput=async file=>globalThis.__bankStatementInputs?.[file.name]||({filename:file.name,base64:"test"});';
  if(file==='Banking.jsx') code=code.replace("import('./bankStatementFile.js')","import('./bankStatementFile.mjs')");
  if(file==='App.jsx') code+='\nexport {Dashboard};';
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
globalThis.__exportApi={bankReceiptHistory:async()=>({receipts:[],reconciliation:null})};
const {default:App}=await import(pathToFileURL(path.join(compiled,'App.mjs')));


const {default:PurchaseLedger}=await import(pathToFileURL(path.join(compiled,'PurchaseLedger.mjs')));
const {Dashboard}=await import(pathToFileURL(path.join(compiled,'App.mjs')));
test('Purchase form validates, saves once, displays persistent history and only updates Dashboard purchase total',async t=>{
 let state={companies:[],agents:[],products:[],accounts:[],ledger:[],productMaster:[],todaySales:[],salesHistory:[],refunds:[],purchases:[]};
 const original=structuredClone(state);let calls=0;
 globalThis.__exportApi.savePurchase=async body=>{calls++;state={...state,purchases:[{...body,id:'purchase-test',amountCents:12345}]};};
 let root=createRoot(document.getElementById('root'));
 const render=async()=>act(async()=>root.render(React.createElement(PurchaseLedger,{state,reload:async()=>root.render(React.createElement(PurchaseLedger,{state,reload:async()=>{}}))})));
 t.after(async()=>act(async()=>root.unmount()));await render();
 const button=()=>document.querySelector('form button');assert.equal(button().disabled,true);
 const change=async(name,value)=>act(async()=>{const el=document.querySelector(`[name="${name}"]`);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 for(const [key,value] of Object.entries({date:'2026-10-14',product:'Test Product',quantity:'3',costPrice:'41.15'}))await change(key,value);
 assert.equal(document.querySelector('[name="supplier"]').required,false);assert.ok(document.querySelector('[name="supplier"]').parentElement.textContent.includes('Supplier (optional)'));assert.ok(document.querySelector('.purchase-ledger-total b'));assert.equal(button().disabled,false);await act(async()=>{const form=document.querySelector('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});assert.equal(calls,1);
 assert.ok(document.querySelector('[aria-label="Purchase history"]').textContent.includes('Test Product'));assert.ok(document.body.textContent.includes('₹123.45'));
 for(const key of Object.keys(original).filter(key=>key!=='purchases'))assert.deepEqual(state[key],original[key]);
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();assert.ok(document.querySelector('[aria-label="Purchase history"]').textContent.includes('Test Product'));
 await act(async()=>root.render(React.createElement(Dashboard,{state})));const total=()=>[...document.querySelectorAll('.fig-cell')].find(c=>c.querySelector('.fig-l').textContent==='Total Purchase').querySelector('.fig-v').textContent;
 assert.equal(total(),'₹123.45');await act(async()=>[...document.querySelectorAll('.filter-toggle button')].find(b=>b.textContent.trim()==='Date Range').click());assert.equal(total(),'₹123.45');
 await act(async()=>root.render(React.createElement(Dashboard,{state:original})));assert.equal(total(),'₹0');
});

test('legacy saved totals display safely, invalid/missing amounts never show NaN and only valid numeric amounts sum',async t=>{
 const purchases=[{id:'legacy',date:'2026-09-01',totalCents:10000},{id:'valid',date:'2026-10-01',amountCents:8500},{id:'missing'},{id:'invalid',amountCents:'oops'},{id:'nan',amountCents:NaN},{id:'infinite',amountCents:Infinity},{id:'negative',amountCents:-100},{id:'string',amountCents:'200'}];
 const before=structuredClone(purchases),root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(purchases,before);});
 await act(async()=>root.render(React.createElement(PurchaseLedger,{state:{purchases},reload:async()=>{}})));
 assert.equal(document.querySelector('.purchase-ledger-total b').textContent,'\u20b9185.00');assert.ok(!document.body.textContent.includes('NaN'));assert.ok(!document.body.textContent.includes('Infinity'));
 assert.equal([...document.querySelectorAll('[aria-label="Purchase history"] tbody tr td:last-child')].filter(el=>el.textContent==='Not available').length,6);
 for(const name of ['date','product','quantity','costPrice'])assert.equal(document.querySelector(`[name="${name}"]`).required,true);
 const css=fs.readFileSync(path.join(project,'client/src/styles.css'),'utf8');assert.match(css,/\.purchase-ledger-total > b \{ font-size: 36px; font-weight: 800/);
});

test('form calculates Qty 12 x 150 as INR 1800 before save, readonly total and six history columns',async t=>{
 const root=createRoot(document.getElementById('root'));t.after(async()=>act(async()=>root.unmount()));await act(async()=>root.render(React.createElement(PurchaseLedger,{state:{purchases:[]},reload:async()=>{}})));
 for(const [name,value] of [['quantity','12'],['costPrice','150']])await act(async()=>{const el=document.querySelector(`[name="${name}"]`);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 const total=document.querySelector('[name="totalPurchaseAmount"]');assert.equal(total.readOnly,true);assert.equal(total.value,'\u20b91,800.00');assert.ok(total.compareDocumentPosition(document.querySelector('form button'))&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.deepEqual([...document.querySelectorAll('[aria-label="Purchase history"] th')].map(el=>el.textContent),['Date','Supplier','Product','Quantity','Cost Price','Total Purchase Amount']);
});
