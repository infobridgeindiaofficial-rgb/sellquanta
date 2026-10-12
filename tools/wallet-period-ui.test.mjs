// Real React DOM/component tests; only PDF I/O and backend APIs are substituted.
// Test dependency: npm install --prefix tmp/selection-component-tests --no-save --package-lock=false jsdom
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from '../tmp/selection-component-tests/node_modules/jsdom/lib/api.js';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
console.info=()=>{};
console.debug=()=>{};

const project=resolve(import.meta.dirname,'..');
mkdirSync(join(project,'tmp'),{recursive:true});
const compiled=mkdtempSync(join(project,'tmp','wallet-period-ui-'));
for(const file of readdirSync(join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=readFileSync(join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api = globalThis.__salesTest.api;';
  if(file==='pdf.js') code='export const fileToPdfPages = (...args)=>globalThis.__salesTest.pdf(...args); export const fileToImageDataUrls=()=>{throw Error("unexpected image fallback")};';
  if(file==='App.jsx') code+='\nexport {Agents};';
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
const {Agents}=await import(pathToFileURL(join(compiled,'App.mjs')));
const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',name:'Agent',companyId:'c'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon'}],products:[{id:'p',name:'Product',sku:'SKU'}],todaySales:[{id:'s',date:'2026-10-01',agentId:'a',productId:'p',marketplace:'Amazon',qty:2,costTotal:20,saleAmount:40}],salesHistory:[],refunds:[],walletResets:[],monthCloseArchive:[],stockMovements:[],ledger:[{id:'sale',type:'SALE',referenceId:'s',agentId:'a',date:'2026-10-01',amount:20}]};
test('real wallet details: All Time default, monthly/custom controls, read-only updates and unchanged wallet table',async()=>{
 let mutationCalls=0; globalThis.__salesTest.api=new Proxy({}, {get:()=>()=>{mutationCalls++;throw Error('Filtering must not call mutation API');}});
 const before=JSON.stringify(state);const root=createRoot(document.getElementById('root'));
 try{await act(async()=>root.render(React.createElement(Agents,{state,reload:async()=>{},notify:()=>{}})));
 const agentButton=document.querySelector('[aria-label="View wallet details for Agent"]');
 const table=agentButton.closest('table');
 await act(async()=>agentButton.click());const tableBefore=table.innerHTML;
 const change=async(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');await act(async()=>{const prototype=input.tagName==='INPUT'?dom.window.HTMLInputElement.prototype:dom.window.HTMLSelectElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
 assert.equal(document.querySelector('[aria-label="Wallet period"]').value,'all');
 await change('Wallet period','monthly');await change('Wallet month','10');await change('Wallet year','2026');
 assert.ok(document.body.textContent.includes('Opening Balance'));assert.ok(document.body.textContent.includes('Closing Balance'));assert.ok(document.body.textContent.includes('Related Transaction History'));
 await change('Wallet period','custom');assert.ok(document.querySelector('[role="alert"]'));
 await change('Wallet from date','2026-10-02');await change('Wallet to date','2026-10-31');assert.equal(document.querySelector('[role="alert"]'),null);
 assert.ok(document.body.textContent.includes('No transactions for this period.'));
 assert.equal(table.innerHTML,tableBefore);assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent.includes('Reset Wallet')));
 await change('Wallet period','all');assert.equal(document.querySelector('[aria-label="Wallet from date"]'),null);
 assert.equal(JSON.stringify(state),before);assert.equal(mutationCalls,0);
 }finally{await act(async()=>root.unmount());}
});
