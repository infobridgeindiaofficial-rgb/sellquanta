import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

export function confirmLocalAiRequest(origin,port,devOrigin){
 const allowed=new Set([`http://127.0.0.1:${port}`]);
 if(devOrigin){const u=new URL(devOrigin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('The development UI origin must be a loopback-only HTTP origin.');allowed.add(u.origin);}
 if(!allowed.has(origin))throw Error('Start Ollama from SellQuanta Settings and confirm the prompt.');
}

export function localOllamaUrl(value='http://127.0.0.1:11434'){
 const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Ollama must use a loopback-only URL on this computer.');
 if(u.hostname==='localhost')u.hostname='127.0.0.1';return u.origin;
}
export function findLocalOllama(env=process.env,exists=f=>{try{return fs.statSync(f).isFile();}catch{return false;}}){
 const names=process.platform==='win32'?['ollama.exe']:['ollama'];
 const dirs=(env.PATH||'').split(path.delimiter).filter(Boolean).map(d=>d.replace(/"/g,''));
 if(env.LOCALAPPDATA)dirs.push(path.join(env.LOCALAPPDATA,'Programs','Ollama'));
 for(const p of [env.ProgramFiles,env['ProgramFiles(x86)']])if(p)dirs.push(path.join(p,'Ollama'));
 return dirs.flatMap(d=>names.map(n=>path.join(d,n))).find(exists)||null;
}
export function modelRecommendation(ramBytes=os.totalmem()){
 const ramGB=Math.round(ramBytes/1024**3);
 return {ramGB,model:ramGB<8?null:'qwen2.5vl:3b',downloadGB:3.2,optionalLargerModel:ramGB>=32?'qwen2.5vl:7b':null,note:ramGB<8?'Use Standard mode; AI is not recommended on less than 8 GB RAM.':'Start with the 3B vision model; 16 GB RAM is preferred. A compatible GPU can improve speed. RAM alone cannot guarantee performance; available memory and GPU support must be checked.'};
}
export async function inspectLocalAi({url,model,fetchImpl=fetch,find=findLocalOllama,ramBytes=os.totalmem()}={}){
 let target;try{target=localOllamaUrl(url);}catch(e){return {installed:!!find(),running:false,status:find()?'Installed / Not Running':'Not Installed',error:e.message,model,modelInstalled:false,visionSupported:false,recommendation:modelRecommendation(ramBytes)};}
 const executable=find();let models=[],running=false,version=null,visionSupported=false;
 try{const r=await fetchImpl(target+'/api/tags',{signal:AbortSignal.timeout(2000)});if(r.ok){const data=await r.json();models=(data.models||[]).map(m=>m.name);running=true;}}catch{}
 const modelInstalled=models.some(n=>n===model||n===model+':latest'||n.replace(/:latest$/,'')===model);
 if(running){try{const r=await fetchImpl(target+'/api/version',{signal:AbortSignal.timeout(2000)});if(r.ok)version=(await r.json()).version;}catch{}
  if(modelInstalled)try{const r=await fetchImpl(target+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model}),signal:AbortSignal.timeout(3000)});if(r.ok)visionSupported=(await r.json()).capabilities?.includes('vision')===true;}catch{}
 }
 return {installed:!!executable||running,running,status:running?'Installed / Running':executable?'Installed / Not Running':'Not Installed',version,model,modelInstalled,visionSupported,recommendation:modelRecommendation(ramBytes),downloadUrl:'https://ollama.com/download/windows',note:'Connection and model capability checks do not prove label-recognition accuracy. No installation, service start or model download occurs during this check.'};
}
let owned=null;
export async function startLocalAi({confirm,url,model,fetchImpl=fetch,find=findLocalOllama,spawnImpl=spawn}={}){
 if(confirm!==true)throw Error('Confirm before starting the local Ollama service.');
 const target=localOllamaUrl(url);if(target!=='http://127.0.0.1:11434')throw Error('Start Ollama yourself when using a custom local port or HTTPS URL.');
 const before=await inspectLocalAi({url:target,model,fetchImpl,find});if(before.running)return {...before,started:false};
 const exe=find();if(!exe)throw Error('Ollama is not installed. Use the official download and install it yourself.');
 if(owned)return {...before,started:true,note:'A confirmed start is already in progress. Run the connection test again.'};
 const child=spawnImpl(exe,['serve'],{windowsHide:true,stdio:'ignore',env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'}});owned=child;
 child.on('error',()=>{if(owned===child)owned=null;});child.on('exit',()=>{if(owned===child)owned=null;});
 return {...before,started:true,note:'Ollama start requested with your consent. Run Test Connection after a few seconds. No models are downloaded.'};
}
