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

test('App discards late old-business reads and clears only its business preferences after successful reset',async t=>{
  const old={...empty(),companies:[{id:'old-id',name:'OLD BUSINESS'}]};
  let stateCalls=0,lateRead;
  Object.assign(globalThis.__resetTestApi,{
    state:()=>{stateCalls++;return stateCalls===1?Promise.resolve(old):stateCalls===2?new Promise(r=>lateRead=r):Promise.resolve(empty());},
    health:async()=>({ollama:{ok:true}}),prepareBusinessReset:async()=>({token:'once',counts:{companies:1}}),
    completeBusinessReset:async()=>({state:empty(),backup:'backups/business-reset/test.json'})
  });
  localStorage.setItem('sp_master_company','old-id');localStorage.setItem('sp_master_marketplace','Amazon');localStorage.setItem('unrelated','keep');
  window.sessionStorage.setItem('sp_master_company','old-id');
  await mount(t,React.createElement(React.StrictMode,null,React.createElement(App)));
  await waitFor(()=>button('Agents & Wallet'));await click(button('Agents & Wallet'));
  await stages();await change(field('Type RESET'),'RESET');await click(button('Reset Everything & Start New Business'));
  await waitFor(()=>document.body.textContent.includes('Add your first company'));
  await act(async()=>lateRead(old));
  assert(!document.body.textContent.includes('OLD BUSINESS'));
  assert.equal(localStorage.getItem('sp_master_company'),null);assert.equal(localStorage.getItem('sp_master_marketplace'),null);
  assert.equal(window.sessionStorage.getItem('sp_master_company'),null);assert.equal(localStorage.getItem('unrelated'),'keep');
});

test('real App/API on copied business: reset, fresh company in Product Master, new stock/agent/mapping/sale and all pages',async t=>{
  const fixtureRoot=path.join(project,'tools/fixtures/business'); // synthetic demo business, no real data
  const livePath=path.join(fixtureRoot,'data/stockpilot.json'),before=fs.readFileSync(livePath);
  const dir=fs.mkdtempSync(path.join(project,'tmp/reset-ui-server-'));
  fs.cpSync(path.join(project,'server'),path.join(dir,'server'),{recursive:true});
  for(const name of ['data','exports','backups/month-close']) if(fs.existsSync(path.join(fixtureRoot,name))) fs.cpSync(path.join(fixtureRoot,name),path.join(dir,name),{recursive:true});
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,[path.join(dir,'server/index.mjs')],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});assert(fs.readFileSync(livePath).equals(before));});
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/api/server-info`)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,30));}assert(ready);
  const apiFile=path.join(compiled,'real-api.mjs');
  fs.writeFileSync(apiFile,fs.readFileSync(path.join(project,'client/src/api.js'),'utf8').replace('http://127.0.0.1:8787/api',`http://127.0.0.1:${port}/api`));
  const {api}=await import(pathToFileURL(apiFile));Object.assign(globalThis.__resetTestApi,api);
  await mount(t,React.createElement(App));await waitFor(()=>button('Agents & Wallet'));
  await click(button('Agents & Wallet'));await stages();await change(field('Type RESET'),'RESET');
  const originalCopy=fs.readFileSync(path.join(dir,'data/stockpilot.json'));
  await click(button('Reset Everything & Start New Business'));
  await waitFor(()=>document.body.textContent.includes('Add your first company'));
  assert(!/Demo Traders|Sample Mart|Example Stores/.test(document.body.textContent));
  const backups=fs.readdirSync(path.join(dir,'backups/business-reset'));assert.equal(backups.length,1);
  assert(fs.readFileSync(path.join(dir,'backups/business-reset',backups[0])).equals(originalCopy));

  await change(field('Company Name'),'TEST NEW COMPANY');await click(button('Add Company'));
  await waitFor(()=>[...document.querySelectorAll('.agent-add select option')].some(o=>o.textContent==='TEST NEW COMPANY'));
  const company=(await api.state()).companies[0];assert.equal(company.name,'TEST NEW COMPANY');
  await click(button('Product Master'));
  assert([...document.querySelector('select').options].some(o=>o.value===company.id&&o.textContent==='TEST NEW COMPANY'));
  assert.equal(document.querySelector('select').value,'');
  await click(button('Warehouse'));
  await change(field('Warehouse Product Code'),'NEW-UI-CODE');await change(field('Product Name'),'NEW UI PRODUCT');
  await change(field('Cost Price'),'10');await change(field('Opening Stock'),'5');await click(button('Add Product'));
  await waitFor(()=>document.querySelector('table')?.textContent.includes('NEW UI PRODUCT'));
  await click(button('Agents & Wallet'));
  await change(document.querySelector('.agent-add input'),'NEW UI AGENT');await change(document.querySelector('.agent-add select'),company.id);
  await click(button('Add Agent'));await waitFor(()=>document.body.textContent.includes('NEW UI AGENT'));
  await click(button('Product Master'));await change(document.querySelector('select'),company.id);await change(document.querySelectorAll('select')[1],'Amazon');
  await click(button('Add Product'));
  const mappingInputs=document.querySelectorAll('.dialog input');
  await change(mappingInputs[0],'NEW-UI-CODE');await change(mappingInputs[1],'NEW-UI-SKU');await change(mappingInputs[2],'NEW UI PRODUCT');
  await click(button('Save Product'));await waitFor(()=>!document.querySelector('.dialog'));
  assert(document.querySelector('table').textContent.includes('NEW-UI-SKU'));
  await click(button('Daily Sales'));
  assert([...field('Agent').options].some(o=>o.textContent==='NEW UI AGENT'));
  await change(field('Amount'),'25');await click(button('Add Sale'));
  await waitFor(()=>document.querySelectorAll('table').length>0&&document.body.textContent.includes('NEW UI PRODUCT'));
  await waitFor(()=>document.body.textContent.includes('1 sale'));
  await click(button('Dashboard'));assert(document.body.textContent.includes('TEST NEW COMPANY'));
  await click(button('Refunds'));assert(document.body.textContent.includes('NEW UI PRODUCT'));
  await click(button('Excel / Close Day'));await waitFor(()=>button('Close Month'));assert(document.body.textContent.includes('Month Close'));
  await api.exportWarehouseBackup();await api.exportCompanyBackup(company.id);
  const fresh=await api.state();assert.equal(fresh.companies.length,1);assert.equal(fresh.products.length,1);assert.equal(fresh.productMaster.length,1);
  assert.equal(fresh.todaySales.length,1);assert.equal(fresh.refunds.length,0);assert.equal(fresh.monthCloseArchive.length,0);
  assert(fs.readFileSync(livePath).equals(before));
  console.log(`Real component/HTTP fresh-business test passed only in ${dir}`);
});
