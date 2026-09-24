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
const compiled=mkdtempSync(join(project,'tmp','scan-accuracy-components-'));
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
// Mixed Amazon + Flipkart + Meesho batch through the real Daily Sales screen, using real label text layers
// (client/src/test-fixtures/labelScanLines.json). Fixture state only - no live data.
const fx=Object.fromEntries(JSON.parse(readFileSync(join(project,'client/src/test-fixtures/labelScanLines.json'),'utf8')).map(f=>[f.name,f]));
const state={companies:[{id:'c1',name:'Demo Traders'}],agents:[{id:'a1',companyId:'c1',name:'Asha'}],
  accounts:['Amazon','Flipkart','Meesho'].map(m=>({id:`ac-${m}`,agentId:'a1',marketplace:m,name:`Asha - ${m}`})),
  products:[{id:'p1',sku:'PRD-25',name:'Water bottle',stock:50},{id:'p3',sku:'PRD-01',name:'Sev maker',stock:50},{id:'p4',sku:'PRD-40',name:'Jar',stock:50},{id:'p5',sku:'PRD-41',name:'Tea container',stock:50}],
  productMaster:[{companyId:'c1',marketplace:'Flipkart',marketplaceSku:'BTL14004',productId:'p1',productName:'bottle'},{companyId:'c1',marketplace:'Flipkart',marketplaceSku:'TIN140011',productId:'p5',productName:'tea container'},
    {companyId:'c1',marketplace:'Amazon',marketplaceSku:'JAR21402',productId:'p4',productName:'jar'},{companyId:'c1',marketplace:'Meesho',marketplaceSku:'tst01-SkuA00000001',productId:'p3',productName:'sev maker'}],
  todaySales:[{id:'old',orderId:'OD400000000000000003',agentId:'a1'}],salesHistory:[]};
const files=[['amazon-cgst-multiline-title','amazon.pdf'],['flipkart-3-identical-items','flipkart3.pdf'],['meesho-label-invoice','meesho.pdf'],['flipkart-single','flipkart-saved.pdf'],['amazon-igst-single','amazon-unmapped.pdf'],['meesho-label-invoice','meesho-again.pdf']]
  .map(([name,file])=>({name:file,type:'application/pdf',size:1,lines:fx[name].lines}));
let root,saves=[],ollama=0;
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith(text));
const click=async el=>{assert.ok(el);await act(async()=>el.click());};
test('mixed batch: correct marketplace, company, agent, warehouse product, quantities and amounts; duplicates and genuine Not Found kept',async()=>{
  Object.assign(globalThis.__salesTest.api,{health:async()=>({ollama:{ok:true}}),addSales:async rows=>{saves.push(rows);return [];},scanLabel:async()=>{ollama++;return {rows:[]};}});
  globalThis.__salesTest.pdf=async file=>[{lines:file.lines,render:()=>assert.fail('no page may need Ollama')}];
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Sales,{state,reload:async()=>{},notify:()=>{},setHealth:()=>{}})));
  const input=document.querySelector('input[type="file"]');
  Object.defineProperty(input,'files',{value:files,configurable:true});
  await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
  await new Promise(r=>setTimeout(r,80));
  try {
    for(const b of [...document.querySelectorAll('button')].filter(b=>/^Select All$/.test(b.textContent.trim()))) await click(b);
    assert.equal(button('Scan Selected').textContent,'Scan Selected (6)');
    await click(button('Scan Selected'));
    assert.equal(ollama,0,'every one of these layouts is read from the PDF text');
    const rows=[...document.querySelectorAll('#scan-rows tbody tr')].map(tr=>{const td=[...tr.children];return {order:td[0].querySelector('input').value,company:td[1].textContent,agent:td[2].textContent,mkt:td[3].textContent,sku:td[4].textContent,qty:td[6].querySelector('input').value,amount:td[7].querySelector('input').value,product:td[8].textContent,status:td[9].textContent};});
    const by=o=>rows.filter(r=>r.order===o);
    const amazon=by('406-0000000-0000002')[0];
    assert.deepEqual([amazon.company,amazon.agent,amazon.mkt,amazon.sku,amazon.qty,amazon.amount],['Demo Traders','Asha','Amazon','JAR21402','30','11940']);
    assert.match(amazon.product,/PRD-40/);assert.match(amazon.status,/Matched/);
    const fk=by('OD300000000000000002');
    assert.equal(fk.length,1,'3 identical item rows = one order row');
    assert.deepEqual([fk[0].sku,fk[0].qty,fk[0].amount],['TIN140011','3','711']);assert.match(fk[0].status,/Matched/);
    const me=by('330000000000000010_1');
    assert.equal(me.length,2);assert.match(me[0].status,/Matched/);assert.equal(me[0].amount,'322.11');
    assert.match(me[1].status,/Duplicate.*repeated in this scan/);
    assert.match(by('OD400000000000000003')[0].status,/Duplicate.*already saved/);
    const un=by('171-0000000-0000003')[0];
    assert.match(un.status,/Not Found.*SKU BAG-TOTE-MULTI-001 is not in Product Master for Amazon/);
    await click(button('Save All Sales'));
    assert.equal(saves.length,1);
    const saved=saves[0].map(r=>[r.orderId,r.productId,r.qty,r.saleAmount,r.marketplaceSku,r.accountId]).sort();
    assert.deepEqual(saved,[['330000000000000010_1','p3',1,322.11,'tst01-SkuA00000001','ac-Meesho'],['406-0000000-0000002','p4',30,11940,'JAR21402','ac-Amazon'],['OD300000000000000002','p5',3,711,'TIN140011','ac-Flipkart']]);
  } finally {await act(async()=>root.unmount());}
});
