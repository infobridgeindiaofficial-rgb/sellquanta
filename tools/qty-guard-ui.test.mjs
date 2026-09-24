// Real React DOM/component tests; only PDF I/O and backend APIs are substituted.
// Test dependency: jsdom (root devDependency)
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
const compiled=mkdtempSync(join(project,'tmp','qty-guard-components-'));
for(const file of readdirSync(join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=readFileSync(join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api = globalThis.__salesTest.api;';
  if(file==='pdf.js') code='export const fileToPdfPages = (...args)=>globalThis.__salesTest.pdf(...args); export const fileToImageDataUrls=()=>{throw Error("unexpected image fallback")};';
  if(file==='App.jsx') code+='\nexport {Sales};';
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
const {Sales}=await import(pathToFileURL(join(compiled,'App.mjs')));
// Scanned rows whose quantity is uncertain must show Needs Review and must never be saved (no stock deduction)
// until the user confirms or corrects the Qty. Fixture state only - no live data.
const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',companyId:'c',name:'Agent'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon'}],products:[{id:'p',sku:'WH',name:'Container',stock:500}],productMaster:[{companyId:'c',marketplace:'Amazon',marketplaceSku:'SSC400-P2',productId:'p',productName:'Container'}],todaySales:[],salesHistory:[]};
const H=['Sl. Unit Net Tax Tax Tax Total','Description Qty','No Price Amount Rate Type Amount Amount'];
const invoice=(prefix='')=>['Order Number: 406-0000000-0000002 Invoice Number : IN-77',...H,'1 Stainless Steel Airtight Container for Kitchen Storage,','400 ml, Pack of 2 |',`${prefix}B0CXYZ1234 ( SSC400-P2 ) ₹337.29 30 ₹10,118.64 18% IGST ₹1,821.36 ₹11,940.00`,'HSN:73239390','TOTAL: ₹1,821.36 ₹11,940.00','Amazon Seller Services Pvt. Ltd.'];
const noQtyField=['amazon.in','Order ID: 406-0000000-0000002','Item SSC400-P2','Stainless Steel Airtight Container 400 ml, Pack of 2','Grand Total: 11,940.00'];
const aiSaysTwo=async()=>({rows:[{orderId:'406-0000000-0000002',sku:'SSC400-P2',productName:'Stainless Steel Airtight Container 400 ml, Pack of 2',qty:2,saleAmount:11940,marketplace:'Amazon'}]});
let root,saves,ollama;
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith(text));
const click=async el=>{assert.ok(el);await act(async()=>el.click());};
async function scan(lines){
  saves=[];ollama=0;
  Object.assign(globalThis.__salesTest.api,{health:async()=>({ollama:{ok:true}}),addSales:async rows=>{saves.push(rows);return [];},scanLabel:async()=>{ollama++;return aiSaysTwo();}});
  globalThis.__salesTest.pdf=async()=>[{lines,render:async()=>'image'}];
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Sales,{state,reload:async()=>{},notify:()=>{},setHealth:()=>{}})));
  const input=document.querySelector('input[type="file"]');
  Object.defineProperty(input,'files',{value:[{name:'label.pdf',type:'application/pdf',size:1}],configurable:true});
  await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
  await new Promise(r=>setTimeout(r,50));
  for(const b of [...document.querySelectorAll('button')].filter(b=>/^Select All$/.test(b.textContent.trim()))) await click(b);
  await click(button('Scan Selected'));
}
const rowStatus=()=>document.querySelector('#scan-rows tbody tr td:last-child').textContent;
const rowQty=()=>document.querySelector('#scan-rows input[aria-label="Qty"]').value;
async function unmount(){if(root)await act(async()=>root.unmount());document.getElementById('root').innerHTML='';}

test('Amazon Pack of 2 / invoice Qty 30: wrapped title reads Qty 30 without Ollama and saves 30',async()=>{
  await scan(invoice());
  try {
    assert.equal(ollama,0);assert.equal(rowQty(),'30');assert.match(rowStatus(),/Matched/);
    await click(button('Save All Sales'));
    assert.equal(saves.length,1);assert.equal(saves[0][0].qty,30);
  } finally {await unmount();}
});
test('title fragment before the ASIN: read from the PDF text (no Ollama), Qty 30',async()=>{
  await scan(invoice('Pack of 2 | '));
  try {
    assert.equal(ollama,0);assert.equal(rowQty(),'30');assert.match(rowStatus(),/Matched/);
    await click(button('Save All Sales'));assert.equal(saves[0][0].qty,30);
  } finally {await unmount();}
});
test('unconfirmed AI quantity: Needs Review, not saved, until the user corrects or confirms it',async()=>{
  await scan(noQtyField);
  try {
    assert.equal(ollama,1);assert.match(rowStatus(),/Needs Review/);assert.match(rowStatus(),/Qty could not be confirmed/);
    assert.match(rowStatus(),/amount .* read by AI - confirm/,'AI amount must be confirmed too');
    assert.equal(button('Save All Sales'),undefined,'no Save All Sales while quantity/amount are uncertain');
    assert.equal(saves.length,0);
    const qty=document.querySelector('#scan-rows input[aria-label="Qty"]');
    const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set;
    await act(async()=>{setter.call(qty,'30');qty.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
    assert.match(rowStatus(),/Needs Review/,'amount still unconfirmed');
    assert.equal(button('Save All Sales'),undefined);
    await click(button('Amount ₹11940 is correct'));
    assert.match(rowStatus(),/Matched/);
    await click(button('Save All Sales'));assert.equal(saves.length,1);assert.equal(saves[0][0].qty,30);
  } finally {await unmount();}
});
test('confirm button accepts the shown Qty explicitly',async()=>{
  await scan(noQtyField);
  try {
    assert.equal(button('Save All Sales'),undefined);
    await click(button('Qty 2 & ₹11940 are correct'));
    assert.match(rowStatus(),/Matched/);
    await click(button('Save All Sales'));assert.equal(saves[0][0].qty,2);
  } finally {await unmount();}
});
