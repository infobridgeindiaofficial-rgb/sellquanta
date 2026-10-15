// Real React DOM/component tests; only PDF I/O and backend APIs are substituted.
// Test dependency: jsdom (root devDependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { dashboardStats, localToday } from '../client/src/dashboardStats.js';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
console.info=()=>{};
console.debug=()=>{};

const project=resolve(import.meta.dirname,'..');
mkdirSync(join(project,'tmp'),{recursive:true});
const compiled=mkdtempSync(join(project,'tmp','scan-integration-components-'));
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
test('real shipping-label UI to API, stock and Dashboard: financial preview, snapshots, missing values, unknown mapping retry and duplicate protection',async t=>{

  const liveBefore=JSON.parse(fs.readFileSync(join(project,'data/stockpilot.json')));
  state.products.forEach(p=>p.costPrice=22);
  state.productMaster.forEach((m,i)=>Object.assign(m,{id:'mapping-'+i,listing_price:99,cost_price:10,estimated_settlement:50,estimated_profit:7.5}));
  delete state.productMaster.find(m=>m.marketplace==='Meesho').estimated_profit;
  const dir=fs.mkdtempSync(join(project,'tmp/scan-integrated-http-'));fs.mkdirSync(join(dir,'data'));
  fs.writeFileSync(join(dir,'data/stockpilot.json'),JSON.stringify({...state,ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[]}));
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,[join(project,'server/index.mjs')],{cwd:project,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:join(dir,'no-client')},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});assert.deepEqual(JSON.parse(fs.readFileSync(join(project,'data/stockpilot.json'))),liveBefore);});
  const request=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}/api${route}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
  let started=false;for(let i=0;i<100;i++){try{await request('/server-info');started=true;break;}catch{}await new Promise(r=>setTimeout(r,40));}assert.ok(started);
  Object.assign(state,await request('/state'));const originalHistory=structuredClone(state.todaySales.find(s=>s.id==='old'));
  const reload=async()=>{Object.assign(state,await request('/state'));root.render(React.createElement(Sales,{state,reload,notify:()=>{},setHealth:()=>{}}));};
  Object.assign(globalThis.__salesTest.api,{health:async()=>({ollama:{ok:true}}),addSales:async rows=>{saves.push(rows);return request('/sales',rows);},scanLabel:async()=>{ollama++;return {rows:[]};}});

  globalThis.__salesTest.pdf=async file=>[{lines:file.lines,render:()=>assert.fail('no page may need Ollama')}];
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Sales,{state,reload,notify:()=>{},setHealth:()=>{}})));
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

    const month=localToday().slice(0,7);
    assert.equal(dashboardStats(state,month).totals.qty,0);
    assert.equal(state.products.find(p=>p.id==='p4').stock,50);
    const details=[...document.querySelectorAll('.scan-financial-details')];assert.equal(details.length,6);
    const amazonDetails=details[0];assert.match(amazonDetails.textContent,/Invoice Amount/);assert.match(amazonDetails.textContent,/Listing Price/);assert.match(amazonDetails.textContent,/Cost Price/);assert.match(amazonDetails.textContent,/Estimated Settlement/);assert.match(amazonDetails.textContent,/Estimated Profit/);assert.match(amazonDetails.textContent,/1,500/);
    const meeshoDetails=details[2];assert.match(meeshoDetails.textContent,/Estimated Profit.*Not available/);
    assert.match(details[4].textContent,/Listing Price.*Not available/);
    await click(button('Save All Sales'));
    await act(async()=>{for(let i=0;i<100&&state.todaySales.filter(s=>s.source==='ollama-label').length<3;i++)await new Promise(r=>setTimeout(r,20));});
    assert.equal(saves.length,1);
    const saved=saves[0].map(r=>[r.orderId,r.productId,r.qty,r.saleAmount,r.marketplaceSku,r.accountId]).sort();
    assert.deepEqual(saved,[['330000000000000010_1','p3',1,322.11,'tst01-SkuA00000001','ac-Meesho'],['406-0000000-0000002','p4',30,11940,'JAR21402','ac-Amazon'],['OD300000000000000002','p5',3,711,'TIN140011','ac-Flipkart']]);

    let d=dashboardStats(state,month);assert.equal(d.totals.qty,34);assert.equal(d.totals.orders,3);assert.equal(d.totals.sales,11940+711+322.11);assert.equal(d.estimates.estimated_settlement.amount,1700);assert.equal(d.estimates.estimated_profit.amount,null);assert.equal(d.estimates.estimated_profit.missingQuantity,1);
    assert.equal(state.products.find(p=>p.id==='p4').stock,20);assert.equal(state.products.find(p=>p.id==='p5').stock,47);assert.equal(state.products.find(p=>p.id==='p3').stock,49);
    const sold=state.todaySales.find(s=>s.orderId==='406-0000000-0000002');assert.equal(sold.financialSnapshot.perUnit.listing_price,99);assert.equal(sold.financialSnapshot.perUnit.cost_price,10);assert.equal(sold.financialSnapshot.totals.estimated_settlement,1500);assert.equal(sold.financialSnapshot.totals.estimated_profit,225);
    const savedBytes=fs.readFileSync(join(dir,'data/stockpilot.json'));await assert.rejects(()=>request('/sales',saves[0]),/already been saved/);assert.ok(fs.readFileSync(join(dir,'data/stockpilot.json')).equals(savedBytes));
    await request('/product-master/'+sold.financialSnapshot.mappingId+'/product',{productId:'p4',estimated_settlement:900,estimated_profit:800});await act(async()=>reload());
    assert.equal(dashboardStats(state,month).estimates.estimated_settlement.amount,1700);assert.match(document.querySelector('.scan-financial-details').textContent,/Captured at sale time/);assert.match(document.querySelector('.scan-financial-details').textContent,/1,500/);

    const beforeRejected=fs.readFileSync(join(dir,'data/stockpilot.json'));
    const unresolved={agentId:'a1',accountId:'ac-Amazon',productId:'p1',marketplaceSku:'BAG-TOTE-MULTI-001',qty:1,saleAmount:100,orderId:'UNRESOLVED-TEST',source:'ollama-label'};
    await assert.rejects(()=>request('/sales',[unresolved]),/Not Found/);
    await assert.rejects(()=>request('/sales',[{...unresolved,marketplaceSku:'tst01-SkuA00000001',productId:'p3'}]),/Not Found/);
    await assert.rejects(()=>request('/sales',[{...unresolved,marketplaceSku:''}]),/Not Found/);
    assert.ok(fs.readFileSync(join(dir,'data/stockpilot.json')).equals(beforeRejected),'Rejected unresolved scans cannot write records or deduct inventory');
    await request('/product-master',{companyId:'c1',marketplace:'Amazon',code:'PRD-25',sku:'BAG-TOTE-MULTI-001',name:'Newly Mapped',listing_price:200,cost_price:30,estimated_settlement:100,estimated_profit:40});await click(button('Refresh mappings'));await act(async()=>{for(let i=0;i<100&&!state.productMaster.some(m=>m.marketplaceSku==='BAG-TOTE-MULTI-001');i++)await new Promise(r=>setTimeout(r,20));});
    assert.equal(document.querySelectorAll('#scan-rows tbody tr').length,6,'Unknown row stays available without rescanning');
    const unknown=[...document.querySelectorAll('#scan-rows tbody tr')].find(r=>r.querySelector('[aria-label="Order ID"]').value==='171-0000000-0000003');assert.match(unknown.textContent,/Matched/);
    await click(button('Save All Sales'));await act(async()=>{for(let i=0;i<100&&state.todaySales.filter(s=>s.source==='ollama-label').length<4;i++)await new Promise(r=>setTimeout(r,20));});assert.equal(saves.length,2);assert.equal(saves[1].length,1);assert.equal(state.products.find(p=>p.id==='p4').stock,20,'Previously saved scan did not deduct again');assert.equal(state.products.find(p=>p.id==='p1').stock,50-Number(saves[1][0].qty));
    assert.deepEqual(state.todaySales.find(s=>s.id==='old'),originalHistory);
  } finally {await act(async()=>root.unmount());}
});
