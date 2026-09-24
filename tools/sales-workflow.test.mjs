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
const compiled=mkdtempSync(join(project,'tmp','sales-components-'));
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
const {default:LabelSegregator}=await import(pathToFileURL(join(compiled,'LabelSegregator.mjs')));
const fixture=(n)=>({name:`label-${n}.pdf`,type:'application/pdf',size:1,lines:['amazon.in',`Order ID: 408-0000000-${String(1265950+n)}`,'SKU: ABC','Quantity: 1','Total: 249.00',`Order Date: ${20+n}.09.2026`]});
const files=[fixture(1),fixture(2)];
const state={companies:[{id:'c',name:'Company'}],agents:[{id:'a',companyId:'c',name:'Agent'}],accounts:[{id:'ac',agentId:'a',marketplace:'Amazon'}],products:[{id:'p',sku:'WH',name:'Product',stock:100}],productMaster:[{companyId:'c',marketplace:'Amazon',marketplaceSku:'ABC',productId:'p',productName:'Product'}],todaySales:[],salesHistory:[]};
let root, pdfCalls, saveCalls, pdfError=false;
const box=()=>[...document.querySelectorAll('input[type="checkbox"]')].sort((a,b)=>a.parentElement.textContent.localeCompare(b.parentElement.textContent));
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith(text));
const click=async el=>{assert.ok(el);await act(async()=>el.click());};
async function mount({health=async()=>({ollama:{ok:true}}),save=async()=>[]}={}) {
  pdfCalls=[];saveCalls=[];pdfError=false;
  Object.assign(globalThis.__salesTest.api,{health,addSales:async rows=>{saveCalls.push(rows);return save(rows);}});
  globalThis.__salesTest.pdf=async file=>{pdfCalls.push(file);if(pdfError)throw Error('bad PDF');return [{lines:file.lines,render:()=>assert.fail('render')}];};
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Sales,{state,reload:async()=>{},notify:()=>{},setHealth:()=>{}}))));
  const input=document.querySelector('input[type="file"]');
  Object.defineProperty(input,'files',{value:files,configurable:true});
  await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
  pdfCalls=[];
}
async function unmount(){if(root)await act(async()=>root.unmount());document.getElementById('root').innerHTML='';}

test('real Sales: A scan/save unselects A and becomes idle even with hanging health; next scan receives only B',async()=>{
  await mount({health:()=>new Promise(()=>{})});
  try {
    await click(box()[0]);await click(button('Scan Selected'));
    assert.deepEqual(pdfCalls,[files[0]]);
    await click(button('Save All Sales'));
    assert.equal(box()[0].checked,false,'saved A checkbox must actually clear');
    assert.ok(!document.querySelector('.upload').textContent.includes('Scanning'),'busy state must end without health completion');
    assert.ok(document.body.textContent.includes('Selected: 0 labels'));
    await click(box()[1]);assert.equal(button('Scan Selected').disabled,false);
    pdfCalls=[];await click(button('Scan Selected'));
    assert.deepEqual(pdfCalls,[files[1]],'runScan must receive only B');
    await click(button('Save All Sales'));assert.equal(box()[1].checked,false);
    assert.equal(box().length,2);assert.equal(document.querySelectorAll('.badge').length>0,true);
  } finally {await unmount();}
});
test('real Sales: A and B selected/scanned; only A saves; B stays selected and scan enabled',async()=>{
  await mount({save:async rows=>{if(rows.length>1 || rows[0].orderId.endsWith('52'))throw Error('not enough stock');return [];}});
  try {
    await click(box()[0]);await click(box()[1]);await click(button('Scan Selected'));
    await click(button('Save All Sales'));
    assert.equal(box()[0].checked,false);assert.equal(box()[1].checked,true);
    assert.equal(button('Scan Selected').textContent,'Scan Selected (1)');
    assert.equal(button('Scan Selected').disabled,false);
    assert.equal(box().length,2);
  } finally {await unmount();}
});
test('real Sales: scan failure returns to idle with pending health and keeps selection',async()=>{
  await mount({health:()=>new Promise(()=>{})});
  try {await click(box()[0]);pdfError=true;await click(button('Scan Selected'));
    assert.equal(box()[0].checked,true);assert.equal(button('Scan Selected').disabled,false);
    assert.ok(!document.querySelector('.upload').textContent.includes('Scanning'));
  } finally {await unmount();}
});
test('real selector: a historical unsaved duplicate must not block confirmed saved source deselection',async()=>{
  globalThis.__salesTest.pdf=async file=>[{lines:file.lines}];
  const scan={complete:true};const pending={_id:'1',_sourceFile:files[0],_sourceScan:scan,orderId:'order-a'};
  const olderDuplicate={...pending,_id:'2',_sourceScan:{complete:true}};
  const props={files,scanning:false,onScanSelected:()=>{},onClear:()=>assert.fail('clear called'),savedOrders:new Set(),scanRows:[pending,olderDuplicate]};
  root=createRoot(document.getElementById('root'));
  try {
    await act(async()=>root.render(React.createElement(LabelSegregator,props)));
    await click(box()[0]);await click(box()[1]);
    await act(async()=>root.render(React.createElement(LabelSegregator,{...props,scanRows:[{...pending,_saved:true},olderDuplicate]})));
    assert.equal(box()[0].checked,false);assert.equal(box()[1].checked,true);
  } finally {await unmount();}
});
test('real selector: 12 selected, one confirmed save removes the actual source from next scan arguments',async()=>{
  const dozen=Array.from({length:12},(_,i)=>fixture(i+1));
  const source={_id:'a',_sourceFile:dozen[0],_sourceScan:{complete:true},orderId:'408-0000000-0000001'};
  let received;
  const props={files:dozen,scanning:false,onScanSelected:files=>{received=files;},onClear:()=>assert.fail('clear called'),savedOrders:new Set(),scanRows:[source]};
  globalThis.__salesTest.pdf=async file=>[{lines:file.lines}];
  root=createRoot(document.getElementById('root'));
  try {
    await act(async()=>root.render(React.createElement(LabelSegregator,props)));
    for(const checkbox of box()) await click(checkbox);
    assert.equal(button('Scan Selected').textContent,'Scan Selected (12)');
    await act(async()=>root.render(React.createElement(LabelSegregator,{...props,scanRows:[{...source,_saved:true}]})));
    assert.equal(button('Scan Selected').textContent,'Scan Selected (11)');
    assert.equal(box().length,12);
    await click(button('Scan Selected'));
    assert.equal(received.length,11);assert.ok(!received.includes(dozen[0]));
  } finally {await unmount();}
});
test('real Sales: failed saves leave source selected and scanning idle',async()=>{
  await mount({save:async()=>{throw Error('rejected');}});
  try {
    await click(box()[0]);await click(button('Scan Selected'));await click(button('Save All Sales'));
    assert.equal(box()[0].checked,true);assert.equal(button('Scan Selected').disabled,false);
    assert.ok(document.body.textContent.includes('rejected'));
  } finally {await unmount();}
});
