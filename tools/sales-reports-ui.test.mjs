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
const compiled=fs.mkdtempSync(path.join(project,'tmp/reports-ui-components-'));
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


const {default:SalesReports}=await import(pathToFileURL(path.join(compiled,'SalesReports.mjs')));
const state={companies:[],products:[],agents:[],accounts:[],ledger:[],productMaster:[],refunds:[],salesHistory:[],todaySales:[{id:'s',date:'2026-10-14',qty:2,saleAmount:300,costTotal:60,marketplace:'Amazon',financialSnapshot:{perUnit:{cost_price:30,estimated_settlement:100,estimated_profit:70}}}],monthCloseArchive:[]};
const change=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
test('report modes filter rows and summary, export selected period without reset, preserve state after remount',async t=>{
 const before=structuredClone(state);let downloads=0,exportSelection;
 globalThis.__exportApi.exportSalesReport=async selection=>{exportSelection={...selection};return {blob:new Blob(['test']),name:'report.xlsx'};};
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldClick=dom.window.HTMLAnchorElement.prototype.click;
 URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){downloads++;};
 t.after(()=>{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;dom.window.HTMLAnchorElement.prototype.click=oldClick;});
 let root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);});
 await act(async()=>root.render(React.createElement(SalesReports,{state})));
 const mode=()=>document.querySelector('select'),date=()=>document.querySelector('input[type="date"]'),exportButton=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Export Excel');
 await change(date(),'2026-10-14');assert.equal(document.querySelectorAll('[aria-label="Sales report"] tbody tr').length,1);
 assert.ok(document.querySelector('[aria-label="Report summary"]').textContent.includes('₹200.00'));
 await act(async()=>exportButton().click());assert.equal(downloads,1);assert.equal(exportSelection.mode,'daily');assert.equal(exportSelection.date,'2026-10-14');
 await change(date(),'2026-10-15');assert.ok(document.body.textContent.includes('No saved sales'));assert.equal(exportButton().disabled,true);
 await change(mode(),'weekly');await change(date(),'2026-10-14');assert.ok(document.body.textContent.includes('2026-10-12 → 2026-10-18'));
 await change(mode(),'monthly');await change(document.querySelector('input[type="month"]'),'2026-09');assert.equal(exportButton().disabled,true);
 await change(mode(),'custom');const inputs=document.querySelectorAll('input[type="date"]');await change(inputs[0],'2026-10-01');await change(inputs[1],'2026-10-14');assert.equal(exportButton().disabled,false);
 await change(inputs[0],'2026-10-15');assert.ok(document.querySelector('[role="alert"]'));assert.equal(exportButton().disabled,true);
 for(const text of ['Close Today','Reset Daily','Close Month'])assert.ok(!document.body.textContent.includes(text));
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(SalesReports,{state})));await change(date(),'2026-10-14');assert.equal(exportButton().disabled,false);
});

test('navigation is Reports / Excel with exact subtitle and restored safety sections',async t=>{
 globalThis.__exportApi.state=async()=>state;globalThis.__exportApi.health=async()=>({ollama:{ok:false}});
 const root=createRoot(document.getElementById('root'));t.after(async()=>act(async()=>root.unmount()));
 await act(async()=>root.render(React.createElement(App)));
 await act(async()=>[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Reports / Excel').click());
 assert.equal(document.querySelector('h1').textContent,'Reports / Excel');assert.ok(document.body.textContent.includes('Generate and export sales reports by date.'));
 assert.equal(document.querySelectorAll('[aria-label="Reports / Excel"] button').length,3);
});

test('Backup Now uses existing API once, reports success/failure; Danger Zone is unchanged and never executed',async t=>{
 const database=fs.readFileSync(path.join(project,'data/stockpilot.json'));
 const before=structuredClone(state);let calls=0,release;
 globalThis.__exportApi.backupInfo=async()=>({dailyCount:2,manualCount:3,keepDays:30});
 globalThis.__exportApi.backupNow=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 globalThis.__exportApi.prepareBusinessReset=()=>assert.fail('Danger Zone must not execute during testing');
 globalThis.__exportApi.completeBusinessReset=()=>assert.fail('Danger Zone must not execute during testing');
 const root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state,before);assert.ok(database.equals(fs.readFileSync(path.join(project,'data/stockpilot.json'))));});
 await act(async()=>root.render(React.createElement(SalesReports,{state,onBusinessReset:()=>assert.fail('No reset')})));
 const section=document.querySelector('[aria-label="Reports / Excel"]');
 assert.equal(section.children[0].querySelector('h3').textContent,'Sales Reports');
 assert.equal(section.children[1].getAttribute('aria-label'),'Data Backup');
 assert.equal(section.lastElementChild.tagName,'DETAILS');assert.equal(section.lastElementChild.querySelector('summary').textContent,'Danger Zone');
 assert.equal(section.lastElementChild.open,false);assert.equal(section.lastElementChild.querySelector('button').textContent,'Complete Reset');
 const backup=document.querySelector('[aria-label="Data Backup"] button');
 await act(async()=>{backup.click();backup.click();});assert.equal(calls,1);assert.equal(backup.disabled,true);
 await act(async()=>release({file:'backups/manual/test.json'}));assert.equal(backup.disabled,false);assert.match(document.querySelector('[aria-label="Data Backup"] [role="status"]').textContent,/Backup saved: backups\/manual\/test.json/);
 globalThis.__exportApi.backupNow=async()=>{throw Error('Synthetic backup failure');};
 await act(async()=>backup.click());assert.match(document.querySelector('[aria-label="Data Backup"] [role="alert"]').textContent,/Synthetic backup failure/);assert.equal(backup.disabled,false);
 // Existing confirmation component is reused, without exercising destructive actions.
 const source=fs.readFileSync(path.join(project,'client/src/SalesReports.jsx'),'utf8');assert.match(source,/<CompleteReset onComplete=\{onBusinessReset\} \/>/);
});
