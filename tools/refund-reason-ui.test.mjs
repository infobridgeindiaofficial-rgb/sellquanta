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
  if(file==='App.jsx') code+='\nexport {Dashboard,Refunds};';
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


const {Refunds}=await import(pathToFileURL(path.join(compiled,'App.mjs')));
test('refund modal blocks missing reason and submits all three reasons explicitly without executing a real refund',async t=>{
 const day=new Date().toLocaleDateString('en-CA'),state={companies:[],agents:[],products:[],todaySales:[{id:'s',date:day,createdAt:new Date().toISOString(),orderId:'ORDER',productName:'Product',marketplace:'Amazon',qty:1,saleAmount:100}],salesHistory:[],refunds:[]};let calls=[];
 globalThis.__exportApi.refundSale=async(id,reason)=>calls.push([id,reason]);const root=createRoot(document.getElementById('root'));t.after(async()=>act(async()=>root.unmount()));await act(async()=>root.render(React.createElement(Refunds,{state,reload:async()=>{},notify:()=>{}})));
 for(const reason of ['Customer Return','Cancelled','RTO']){
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Refund').click());const dialog=document.querySelector('[role="dialog"]');assert.ok(dialog.textContent.includes('ORDER'));assert.ok(dialog.textContent.includes('Product'));const confirm=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Confirm Refund');assert.equal(confirm.disabled,true);
 await act(async()=>{const el=dialog.querySelector('select');Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,reason);el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.equal(confirm.disabled,false);await act(async()=>confirm.click());assert.deepEqual(calls.at(-1),['s',reason]);assert.equal(document.querySelector('[role="dialog"]'),null);
 }assert.equal(calls.length,3);
});

test('Refund History shows confirmed marketplace match and amount, awaiting customer returns, and normal other reasons',async t=>{
 const base={id:'r',saleId:'s',marketplace:'Amazon',refundReason:'Customer Return',qty:1,refundAmount:100};
 const state={companies:[],agents:[],products:[],todaySales:[],salesHistory:[],refunds:[{...base,id:'matched',orderId:'406-4079649-7363539'},{...base,id:'waiting',orderId:'404-6609958-8471548'},{...base,id:'cancelled',orderId:'cancelled',refundReason:'Cancelled'},{...base,id:'rto',orderId:'rto',refundReason:'RTO'}],returnCharges:[{id:'charge',duplicateKey:'same',marketplace:'Amazon',orderId:'406-4079649-7363539',status:'Confirmed',amountCents:5310},{id:'copy',duplicateKey:'same',marketplace:'Amazon',orderId:'406-4079649-7363539',status:'Confirmed',amountCents:5310},{id:'review',marketplace:'Amazon',orderId:'404-6609958-8471548',status:'Needs Review',amountCents:1000}]};
 const before=structuredClone(state),root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await act(async()=>root.render(React.createElement(Refunds,{state,reload:async()=>{},notify:()=>{}})));
 const row=id=>[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes(id));
 assert.ok(row('406-4079649-7363539').textContent.includes('Matched & Confirmed'));assert.ok(row('406-4079649-7363539').textContent.includes('\u20b953.10'));assert.ok(row('406-4079649-7363539').querySelector('.badge.saved'));
 assert.ok(row('404-6609958-8471548').textContent.includes('Awaiting Marketplace Match'));assert.ok(row('404-6609958-8471548').querySelector('.badge.warn'));
 for(const reason of ['Cancelled','RTO']){const found=[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes(reason));assert.ok(!found.textContent.includes('Awaiting Marketplace Match'));}
});
