// Real React components with API/PDF boundaries mocked; no live requests or writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from '../client/node_modules/esbuild/lib/main.js';

const project = path.resolve(import.meta.dirname, '..');
const compiled = fs.mkdtempSync(path.join(project, 'tmp/company-components-'));
for (const file of fs.readdirSync(path.join(project, 'client/src')).filter(f => /\.(jsx|js)$/.test(f) && !f.endsWith('.test.js'))) {
  let code = fs.readFileSync(path.join(project, 'client/src', file), 'utf8');
  if (file === 'api.js') code = 'export const api = globalThis.__companyApi;';
  if (file === 'pdf.js') code = 'export const fileToPdfPages = async f => [{lines:f.lines,render:()=>{throw Error("unexpected image fallback")}}]; export const fileToImageDataUrls=()=>{throw Error("unexpected image fallback")};';
  if (file === 'App.jsx') code += '\nexport {CompanyManagement, Agents, ProductMaster, Sales, Dashboard};';
  code = code.replace(/from (["'])\.\/([^"']+)\1/g, (_, q, name) => `from ${q}./${name.replace(/\.(js|jsx)$/, '')}.mjs${q}`)
    .replace(/from (["'])react\1/g, `from '${pathToFileURL(path.join(project, 'client/node_modules/react/index.js')).href}'`);
  fs.writeFileSync(path.join(compiled, file.replace(/\.(js|jsx)$/, '.mjs')), (await transform(code, { loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'esm' })).code);
}
const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:5173' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.confirm = () => true;
const React = await import('../client/node_modules/react/index.js');
const { act } = React;
const { createRoot } = await import('../client/node_modules/react-dom/client.js');
globalThis.__companyApi = {};
const { default: App, CompanyManagement, Agents, ProductMaster, Sales, Dashboard } = await import(pathToFileURL(path.join(compiled, 'App.mjs')));
const empty = () => ({companies:[],agents:[],accounts:[],productMaster:[],products:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[]});
const fixture = () => ({...empty(),
  companies: [1,2,3,4].map(n => ({id:`c${n}`,name:`Company ${n}`})),
  agents: [{id:'a4',companyId:'c4',name:'Fourth Agent',active:true}],
  accounts: [{id:'ac4',agentId:'a4',marketplace:'Amazon',name:'Fourth Account'}],
  products: [{id:'p',sku:'WAREHOUSE',name:'Product',stock:10}],
  productMaster: [{id:'m',companyId:'c4',marketplace:'Amazon',marketplaceSku:'FOURTH',productId:'p',productName:'Product'}]
});
const buttons = text => [...document.querySelectorAll('button')].filter(b => b.textContent === text);
const change = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const click = async el => { assert(el); await act(async () => el.click()); };
async function mount(t, Component, initial) {
  let state = initial;
  const root = createRoot(document.getElementById('root'));
  const render = async () => root.render(React.createElement(Component, { state, reload: render, notify:()=>{}, setHealth:()=>{} }));
  await act(render);
  t.after(async () => { await act(async () => root.unmount()); localStorage.clear(); });
  return { update: async value => { state = value; await act(render); } };
}

test('Company Management adds, renames with stable ID, archives used and deletes unused companies', async t => {
  const state = empty();
  const calls = [];
  Object.assign(globalThis.__companyApi, {
    addCompany: async name => { calls.push(['add',name]); state.companies.push({id:'stable',name}); },
    renameCompany: async (id,name) => { calls.push(['rename',id,name]); state.companies.find(c=>c.id===id).name=name; },
    removeCompany: async id => {
      calls.push(['remove',id]);
      if (state.agents.some(a=>a.companyId===id)) { state.companies.find(c=>c.id===id).active=false; return {deactivated:true}; }
      state.companies=state.companies.filter(c=>c.id!==id); return {deleted:true};
    }
  });
  await mount(t, CompanyManagement, state);
  assert(document.body.textContent.includes('Add your first company'));
  await change(document.querySelector('input'), 'ABC Traders');
  await click(buttons('Add Company')[0]);
  assert(document.body.textContent.includes('ABC Traders'));
  await click(buttons('Rename')[0]);
  await change(document.querySelector('[aria-label="Edit company name"]'), 'XYZ Enterprises');
  await click(buttons('Save name')[0]);
  assert.deepEqual(calls[1], ['rename','stable','XYZ Enterprises']);
  state.agents.push({id:'a',companyId:'stable'});
  await click(buttons('Remove')[0]);
  assert(document.body.textContent.includes('Archived'));
  assert.equal(state.agents[0].companyId,'stable');
  await change(document.querySelector('input'), 'Unused');
  // Assign a distinct stable ID to the next created company.
  globalThis.__companyApi.addCompany=async name=>state.companies.push({id:'unused',name});
  await click(buttons('Add Company')[0]);
  await click(buttons('Remove')[0]);
  assert(!state.companies.some(c=>c.id==='unused'));
});

test('fourth company appears in agent selectors; archived company remains in wallet filters/history', async t => {
  const state = fixture();
  await mount(t, Agents, state);
  const selects = [...document.querySelectorAll('select')];
  assert([...selects[0].options].some(o=>o.value==='c4'));
  await change(selects[0], 'c4');
  let body;
  globalThis.__companyApi.addAgent=async (name,companyId)=>{body={name,companyId};return {};};
  await change(document.querySelector('.agent-add input'), 'New Agent');
  await click(buttons('Add Agent')[0]);
  assert.deepEqual(body,{name:'New Agent',companyId:'c4'});
});

test('Product Master excludes archived companies and clears remembered/selected archived IDs', async t => {
  let state = fixture();
  localStorage.setItem('sp_master_company','c4');
  const view = await mount(t, ProductMaster, state);
  let select = document.querySelector('select');
  assert.equal(select.value,'c4');
  state=structuredClone(state);state.companies[3].active=false;
  await view.update(state);
  select=document.querySelector('select');
  assert.equal(select.value,'');
  assert(![...select.options].some(o=>o.value==='c4'));
  assert.equal(localStorage.getItem('sp_master_company'),'');
});

test('archived company cannot resolve new label/manual sale; scanner remains fast and keeps its row', async t => {
  let state = fixture();
  globalThis.__companyApi.health=async()=>({ollama:{ok:true}});
  const view=await mount(t,Sales,state);
  assert(document.body.textContent.includes('Fourth Agent'));
  const file={name:'fourth.pdf',size:1,type:'application/pdf',lines:['amazon.in','Order ID: 408-0000000-0000001','SKU: FOURTH','Quantity: 1','Total: 249.00']};
  const input=document.querySelector('input[type="file"]');
  Object.defineProperty(input,'files',{value:[file],configurable:true});
  await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})));
  await click(document.querySelector('input[type="checkbox"]'));
  await click([...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Scan Selected')));
  assert(document.body.textContent.includes('Matched'));
  state=structuredClone(state);state.companies[3].active=false;
  await view.update(state);
  const agentSelect=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent==='Select agent'));
  assert(![...agentSelect.options].some(o=>o.value==='a4'));
  assert(document.body.textContent.includes('Not Found'));
  assert(document.body.textContent.includes('408-0000000-0000001'));
  assert.equal(buttons('Save All Sales').length,0);
});

test('fresh App shows simple company setup', async t => {
  const state=empty();
  Object.assign(globalThis.__companyApi,{state:async()=>state,health:async()=>({ollama:{ok:true}})});
  await mount(t,App,state);
  assert(document.body.textContent.includes('Add your first company'));
  await click(buttons('Add Company')[0]);
  assert(document.body.textContent.includes('Company Management'));
  assert(!/Demo Traders|Sample Mart|Example Stores/.test(document.body.textContent));
});

test('wallet filters keep archived company names visible while new payment/agent selectors exclude them', async t => {
  const state=fixture();state.companies[3].active=false;
  await mount(t,Agents,state);
  const filter=document.querySelector('[aria-label="Company filter"]');
  assert([...filter.options].some(o=>o.value==='c4'));
  assert(document.querySelector('table').textContent.includes('Company 4'));
  const companySelect=document.querySelector('.agent-add select');
  assert(![...companySelect.options].some(o=>o.value==='c4'));
  const paymentSelect=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent==='Select agent'));
  assert(![...paymentSelect.options].some(o=>o.value==='a4'));
});

test('Dashboard renders one, four and archived companies from stored records', async t => {
  let state=fixture();
  const view=await mount(t,Dashboard,state);
  assert(document.body.textContent.includes('Company 4'));
  state=structuredClone(state);state.companies[3].active=false;
  await view.update(state);
  assert(document.body.textContent.includes('Company 4'));
  state=structuredClone(state);state.companies=state.companies.slice(0,1);
  await view.update(state);
  assert(document.body.textContent.includes('Company 1'));
  assert(!document.body.textContent.includes('Company 4'));
});
