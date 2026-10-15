// Real React UI; the end-to-end case uses the real API against a copied server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/reset-ui-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f)&&!f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__resetTestApi;';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{};export const fileToImageDataUrls=()=>{};';
  code=code.replace(/from (["'])\.\/([^"']+)\1/g,(_,q,name)=>`from ${q}./${name.replace(/\.(js|jsx)$/,'')}.mjs${q}`)
    .replace(/from (["'])react\1/g,`from '${pathToFileURL(path.join(project,'client/node_modules/react/index.js')).href}'`);
  fs.writeFileSync(path.join(compiled,file.replace(/\.(js|jsx)$/,'.mjs')),(await transform(code,{loader:file.endsWith('.jsx')?'jsx':'js',format:'esm'})).code);
}
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5173'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;
globalThis.localStorage=window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('../client/node_modules/react/index.js');
const {act}=React;
const {createRoot}=await import('../client/node_modules/react-dom/client.js');
globalThis.__resetTestApi={monthCloseList:async()=>({archives:[]}),backupInfo:async()=>({})};
const {default:CompleteReset}=await import(pathToFileURL(path.join(compiled,'CompleteReset.mjs')));
const {default:App}=await import(pathToFileURL(path.join(compiled,'App.mjs')));
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
const field=label=>[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label))?.querySelector('input,select');
const click=async el=>{assert(el);await act(async()=>el.click());};
async function change(el,value) {
  assert(el);
  await act(async()=>{
    Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype,'value').set.call(el,value);
    el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  });
}
async function waitFor(predicate) {
  for(let i=0;i<100;i++){await act(async()=>new Promise(r=>setTimeout(r,20)));if(predicate())return;}
  assert(predicate(),'Timed out waiting for UI: '+document.body.textContent.slice(-1600));
}
async function mount(t,element) {
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(element));
  t.after(async()=>{await act(async()=>root.unmount());localStorage.clear();window.sessionStorage.clear();});
}
const empty=()=>({meta:{version:1},companies:[],agents:[],accounts:[],products:[],productMaster:[],todaySales:[],salesHistory:[],ledger:[],stockMovements:[],refunds:[],monthCloseArchive:[],dueByAgent:{}});
async function stages() {
  const closePage=button('Excel / Close Day');
  if(closePage) {
    assert(!document.querySelector('details'),'Danger Zone must not appear on Agents & Wallet');
    await click(closePage);
    assert.equal(document.querySelector('main').lastElementChild.tagName,'DETAILS','Danger Zone must be the last page section');
  }
  const details=document.querySelector('details');await act(async()=>{details.open=true;});
  await click(button('Complete Reset'));
  await click(button('Continue to Confirmation'));
  await waitFor(()=>document.querySelector('[aria-label="Type RESET to confirm"]'));
}

test('two intentional stages, exact typed RESET and double-click protection',async t=>{
  let prepared=0,resets=0,completed=0,release;
  Object.assign(globalThis.__resetTestApi,{
    prepareBusinessReset:async()=>{prepared++;return {token:'once',counts:{companies:3}};},
    completeBusinessReset:(token,text)=>{assert.equal(token,'once');assert.equal(text,'RESET');resets++;return new Promise(r=>release=r);}
  });
  await mount(t,React.createElement(CompleteReset,{onComplete:()=>completed++}));
  assert.equal(document.querySelector('details').open,false);
  await click(button('Complete Reset'));assert.equal(prepared,0);assert.equal(resets,0);
  assert(document.body.textContent.includes('warehouse products and images'));
  await click(button('Continue to Confirmation'));assert.equal(prepared,1);
  const final=button('Reset Everything & Start New Business');assert.equal(final.disabled,true);
  for(const text of ['reset',' RESET','RESET ']){await change(field('Type RESET'),text);assert.equal(final.disabled,true);}
  await change(field('Type RESET'),'RESET');assert.equal(final.disabled,false);
  await act(async()=>{final.click();final.click();});assert.equal(resets,1);
  await act(async()=>release({state:empty(),backup:'backups/business-reset/test.json'}));assert.equal(completed,1);
});

test('cancel and API failures never clear frontend business state or automatically retry',async t=>{
  let completed=0,calls=0;
  Object.assign(globalThis.__resetTestApi,{
    prepareBusinessReset:async()=>({token:'once',counts:{}}),
    completeBusinessReset:async()=>{calls++;throw Error('Backup verification failed');}
  });
  await mount(t,React.createElement(CompleteReset,{onComplete:()=>completed++}));
  await stages();await click(button('Cancel'));assert.equal(calls,0);
  await stages();await change(field('Type RESET'),'RESET');await click(button('Reset Everything & Start New Business'));
  assert.equal(calls,1);assert.equal(completed,0);
  assert(document.querySelector('[role="alert"]').textContent.includes('Backup verification failed'));
  assert(button('Continue to Confirmation'));assert(!button('Reset Everything & Start New Business'));
});

