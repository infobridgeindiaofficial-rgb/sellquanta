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
const compiled=fs.mkdtempSync(path.join(project,'tmp/return-ui-components-'));
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


import XLSX from 'xlsx';
import {parseReturnReport} from '../server/returnCharges.mjs';
import {createReturnChargePersistence} from '../server/returnChargeRoutes.mjs';
const {default:ReturnCharges}=await import(pathToFileURL(path.join(compiled,'ReturnCharges.mjs')));
globalThis.FileReader=dom.window.FileReader;
test('Return Charges UI scans without saving, requires selected approval, displays persistent ledger and totals',async t=>{
 const original=fs.readFileSync(path.join(project,'data/stockpilot.json'));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Order ID','Order item ID','Seller SKU','Return Type','Item Return Status','Reverse Shipping Fee (Rs.)','Payment Date'],['TEST','ITEM','SKU','Customer Return','Product Delivered',-184,'2026-09-10']]),'Orders');
 const preview=parseReturnReport({filename:'test.xlsx',base64:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}).toString('base64')});preview.token='test-token';preview.rows.push({...preview.rows[0],id:'review-row',duplicateKey:'review-key',status:'Needs Review',amountCents:5310,reason:'Ambiguous refund fee'});preview.reviewCount=1;
 const dir=fs.mkdtempSync(path.join(project,'tmp/return-ui-ledger-')),dbFile=path.join(dir,'db.json');fs.writeFileSync(dbFile,'{}');const persist=createReturnChargePersistence({dbFile,backupDir:path.join(dir,'backups')});let saves=0,reloads=0;
 globalThis.__exportApi.returnChargeHistory=async()=>({records:JSON.parse(fs.readFileSync(dbFile)).returnCharges||[]});
 globalThis.__exportApi.scanReturnCharges=async body=>{assert.equal(body.filename,'test.xlsx');return preview;};
 globalThis.__exportApi.saveReturnCharges=async body=>{assert.equal(body.confirm,true);saves++;return persist(preview.rows.filter(r=>body.approved.includes(r.id)));};
 let root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.ok(original.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))));});
 await act(async()=>root.render(React.createElement(ReturnCharges,{onSaved:async()=>{reloads++;}})));
 const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
 assert.equal(button('Confirm & Save').disabled,true);
 const upload=document.querySelector('input[type="file"]');await act(async()=>{Object.defineProperty(upload,'files',{value:[new dom.window.File(['report'],'test.xlsx')],configurable:true});upload.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 await act(async()=>{button('Scan').click();await new Promise(r=>setTimeout(r,30));});
 assert.equal(saves,0);assert.equal(JSON.parse(fs.readFileSync(dbFile)).returnCharges,undefined);assert.ok(document.querySelector('[aria-label="Return charge preview"]').textContent.includes('Reverse Shipping Fee'));
 assert.equal(button('Confirm & Save').disabled,true);
 assert.equal(document.querySelectorAll('.return-charge-confirmed').length,1);assert.equal(document.querySelectorAll('.return-charge-review').length,1);assert.ok(document.querySelector('[aria-label="Return charge scan summary"]').textContent.includes('53.10'));
 const css=fs.readFileSync(path.join(project,'client/src/styles.css'),'utf8');assert.match(css,/\.return-charge-preview \{ width: 100%; table-layout: fixed;/);assert.match(css,/overflow-wrap: anywhere/);assert.match(css,/\.return-charge-preview th \{ position: sticky; top: 0/);assert.match(css,/@container \(max-width: 1100px\)/);assert.equal(document.querySelectorAll('[aria-label="Return charge preview"] th').length,12);
 await act(async()=>document.querySelector('[aria-label="Return charge preview"] input[type="checkbox"]').click());assert.equal(button('Confirm & Save').disabled,false);
 await act(async()=>button('Confirm & Save').click());assert.equal(saves,1);assert.equal(reloads,1);assert.ok(document.querySelector('[aria-label="Return charges ledger"]').textContent.includes('TEST'));assert.ok(document.body.textContent.includes('₹184.00'));
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(ReturnCharges,{onSaved:async()=>{reloads++;}})));assert.ok(document.querySelector('[aria-label="Return charges ledger"]').textContent.includes('TEST'));
});
