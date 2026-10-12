import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {transform} from '../client/node_modules/esbuild/lib/main.js';
const root=path.resolve(import.meta.dirname,'..');
const folder=fs.mkdtempSync(path.join(root,'tmp','settings-ui-'));
let code=fs.readFileSync(path.join(root,'client/src/Settings.jsx'),'utf8').replace(/import.*from ['"]\.\/api['"];?/,'const api=globalThis.__settingsApi;').replace(/from ['"]react['"]/g,`from '${pathToFileURL(path.join(root,'client/node_modules/react/index.js')).href}'`);
fs.writeFileSync(path.join(folder,'Settings.mjs'),(await transform(code,{loader:'jsx',format:'esm'})).code);
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5199'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.__settingsApi={};
const React=await import('../client/node_modules/react/index.js');const {createRoot}=await import('../client/node_modules/react-dom/client.js');const {default:Settings}=await import(pathToFileURL(path.join(folder,'Settings.mjs')));
test('Settings does read-only detection; explicit start confirmation, local test, manual fallback and errors',async()=>{
 let checks=0,starts=0;
 const status={status:'Installed / Not Running',installed:true,running:false,model:'qwen2.5vl:3b',modelInstalled:false,visionSupported:false,recommendation:{ramGB:16,model:'qwen2.5vl:3b',note:'Fixture'}};
 Object.assign(globalThis.__settingsApi,{localAiStatus:async()=>{checks++;return status;},startLocalAi:async()=>{starts++;return {...status,running:true,status:'Installed / Running'};}});
 const view=createRoot(document.getElementById('root'));
 try {
  await React.act(async()=>view.render(React.createElement(Settings,{notify:()=>{}})));
  assert.equal(checks,1);assert.equal(starts,0);assert.match(document.body.textContent,/Manual Windows Download/);assert.match(document.body.textContent,/Core business features/);
  const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent===name);
  window.confirm=()=>false;await React.act(async()=>button('Start Installed Ollama').click());assert.equal(starts,0);
  window.confirm=()=>true;await React.act(async()=>button('Start Installed Ollama').click());assert.equal(starts,1);assert.match(document.body.textContent,/Installed \/ Running/);
  await React.act(async()=>button('Test Connection').click());assert.equal(checks,2);
  globalThis.__settingsApi.localAiStatus=async()=>{throw Error('Connection fixture error');};await React.act(async()=>button('Test Connection').click());assert.match(document.body.textContent,/Connection fixture error/);
 }finally{await React.act(async()=>view.unmount());}
});
