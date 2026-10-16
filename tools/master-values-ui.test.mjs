import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';
const project=path.resolve(import.meta.dirname,'..');
const compiled=fs.mkdtempSync(path.join(project,'tmp/master-values-components-'));
for(const file of fs.readdirSync(path.join(project,'client/src')).filter(f=>/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code=fs.readFileSync(path.join(project,'client/src',file),'utf8');
  if(file==='api.js') code='export const api=globalThis.__exportApi;';
  if(file==='bankStatementFile.js') code='export const statementInput=(...args)=>globalThis.__statementInput(...args);';
  if(file==='pdf.js') code='export const fileToPdfPages=()=>{}; export const fileToImageDataUrls=()=>{};';
  if(file==='App.jsx') code+='\nexport {Warehouse,ProductMaster};';
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
globalThis.__exportApi={};
const {Warehouse,ProductMaster}=await import(pathToFileURL(path.join(compiled,'App.mjs')));

const input=label=>[...document.querySelectorAll('label')].find(l=>l.firstChild?.textContent===label)?.querySelector('input,select');
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text||b.dataset.label===text);
const change=async(el,value)=>{assert(el);await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
const click=async(el)=>{assert(el);await act(async()=>el.click());};
test('Product Master keeps existing workflow and manually creates/edits all four optional values in every marketplace',async t=>{
 const {masterValues}=await import('../server/masterValues.mjs');
 const state={companies:[{id:'c',name:'Company'}],products:[{id:'p',sku:'PDN',name:'Warehouse',stock:8,costPrice:500}],productMaster:[]};
 const original=structuredClone(state.products),calls={templates:[],exports:[],imports:[]};
 localStorage.clear();globalThis.FileReader=dom.window.FileReader;
 URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=()=>{};
 Object.assign(globalThis.__exportApi,{
  addMasterProduct:async body=>state.productMaster.push({id:body.marketplace,companyId:body.companyId,marketplace:body.marketplace,productId:'p',marketplaceSku:body.sku,productName:body.name,...masterValues(body)}),
  updateMasterProduct:async(id,productId,updateName,values)=>{const row=state.productMaster.find(m=>m.id===id);row.productId=productId;if(updateName)row.productName='Warehouse';Object.assign(row,masterValues(values));},
  productMasterTemplate:async(companyId,marketplace)=>{calls.templates.push({companyId,marketplace});return {blob:new Blob(['test']),name:'Product_Master.xlsx'};},
  exportCompanyBackup:async companyId=>{calls.exports.push(companyId);return {blob:new Blob(['test']),name:'Backup.xlsx'};},
  importProductMaster:async body=>{calls.imports.push(body);return {added:0,updated:0,errors:[]};}
 });
 const root=createRoot(document.getElementById('root'));
 const render=()=>root.render(React.createElement(ProductMaster,{state,reload:async()=>render(),notify:()=>{}}));
 await act(async()=>render());t.after(async()=>{await act(async()=>root.unmount());assert.deepEqual(state.products,original);});
 await change(input('Company'),'c');
 for(const marketplace of ['Amazon','Flipkart','Meesho']){
  await change(input('Marketplace'),marketplace);await click(button('Add Product'));
  for(const [label,value] of Object.entries({'Warehouse Product Code':'PDN','Marketplace SKU':'SKU','Product Name':'Custom','Listing Price (INR)':'300','Cost Price (INR)':'75.50','Estimated Settlement (INR)':'200','Estimated Profit (INR)':'17.25'}))await change(input(label),value);
  await change(input('Cost Price (INR)'),'90');assert.equal(input('Estimated Profit (INR)').value,'17.25');
  await click(button('Save Product'));assert.equal(state.productMaster.at(-1).estimated_profit,17.25);assert.equal(state.productMaster.at(-1).cost_price,90);
  await click(document.querySelector('[aria-label="Edit mapping"]'));
  await click(document.querySelector('input[type="checkbox"]'));
  const profit=document.querySelector('[aria-label="Edit Estimated Profit (INR)"]');assert.equal(profit.value,'17.25');await change(profit,'-9.50');
  await change(document.querySelector('[aria-label="Edit Listing Price (INR)"]'),'350');assert.equal(profit.value,'-9.50');
  await click(document.querySelector('[aria-label="Save"]'));assert.equal(state.productMaster.at(-1).estimated_profit,-9.5);assert.equal(state.productMaster.at(-1).productName,'Custom');
  await click(button('Download Excel Template'));assert.equal(calls.templates.at(-1).marketplace,marketplace);
  const upload=document.querySelector('input[type="file"]');await act(async()=>{Object.defineProperty(upload,'files',{value:[new dom.window.File(['excel'],'Product_Master.xlsx')],configurable:true});upload.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,30));});
  assert.equal(calls.imports.at(-1).marketplace,marketplace);assert.equal(calls.imports.at(-1).companyId,'c');
 }
 assert.equal(state.productMaster.length,3);assert.equal(calls.templates.length,3);
 await click(button('Export Company Backup'));assert.deepEqual(calls.exports,['c']);
});
