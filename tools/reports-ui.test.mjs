// Real React DOM/component tests; only PDF I/O and backend APIs are substituted.
// Uses the existing jsdom development dependency.
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
const compiled=mkdtempSync(join(project,'tmp','reports-ui-'));
for(const file of readdirSync(join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=readFileSync(join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api = globalThis.__salesTest.api;';
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
const {ReportsPage}=await import(pathToFileURL(join(compiled,'App.mjs')));
test('Reports UI filters all periods read-only, renders trends and preserves Backup/Danger Zone order',async()=>{
 const state={companies:[],agents:[],accounts:[],products:[],todaySales:[{id:'a',date:'2026-10-01',qty:2,saleAmount:80,marketplace:'Amazon'},{id:'b',date:'2026-10-31',qty:1,saleAmount:50,marketplace:'Meesho'}],salesHistory:[],refunds:[{id:'r',refundDate:'2026-10-02',qty:1,refundAmount:25,marketplace:'Amazon'}],ledger:[],monthCloseArchive:[]};
 const before=JSON.stringify(state);globalThis.__salesTest.api.backupInfo=async()=>({});
 const root=createRoot(document.getElementById('root'));try{await act(async()=>root.render(React.createElement(ReportsPage,{state,notify:()=>{},onBusinessReset:()=>{}})));
 const change=async(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');assert.ok(input);await act(async()=>{const prototype=input.tagName==='INPUT'?dom.window.HTMLInputElement.prototype:dom.window.HTMLSelectElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
 const metric=label=>[...document.querySelectorAll('.stat')].find(c=>c.querySelector('.stat-label')?.textContent===label).querySelector('.stat-value').textContent;
 assert.equal(document.querySelector('[aria-label="Report period"]').value,'daily');await change('Report date','2026-10-01');assert.ok(metric('Total Sales').includes('80'));
 await change('Report period','weekly');assert.ok(document.body.textContent.includes('2026-09-28'));assert.ok(metric('Net Sales').includes('55'));
 await change('Report period','monthly');await change('Report month','2026-10');assert.ok(metric('Total Sales').includes('130'));assert.ok(metric('Net Sales').includes('105'));
 await change('Report period','yearly');await change('Report year','2026');assert.ok(metric('Total Sales').includes('130'));
 await change('Report period','custom');await change('Report from date','2026-10-02');await change('Report to date','2026-10-31');assert.ok(metric('Net Sales').includes('25'));
 assert.equal(document.querySelectorAll('svg[role="img"]').length,2);assert.ok(document.body.textContent.includes('Amazon'));assert.ok(document.body.textContent.includes('Flipkart'));assert.ok(document.body.textContent.includes('Meesho'));
 assert.ok(document.body.textContent.includes('Agent-wise Sales'));assert.ok(document.body.textContent.includes('Product-wise Sales'));
 await change('Report from date','2026-11-01');assert.ok(document.querySelector('[role="alert"]'));assert.equal([...document.querySelectorAll('button')].find(b=>b.dataset.label==='Export Excel').disabled,true);
 const text=document.body.textContent;assert.ok(text.indexOf('Data Backup')<text.indexOf('Danger Zone'));assert.equal(document.getElementById('root').lastElementChild.tagName,'DETAILS');
 assert.ok(!text.includes('Close Month'));assert.ok(!text.includes('Reset Daily Sales'));assert.equal(JSON.stringify(state),before);
 }finally{await act(async()=>root.unmount());}
});
