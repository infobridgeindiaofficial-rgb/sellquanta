import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
const manual='https://infobridgeindia.online/sellquanta/download.html';
export default function Settings({notify}){
 const [update,setUpdate]=useState({status:'manual',manualUrl:manual}),[ai,setAi]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);
 const desktop=window.sellquantaDesktop;
 useEffect(()=>{let active=true;desktop?.getUpdateStatus().then(s=>{if(active)setUpdate(s);}).catch(e=>{if(active)setError(e.message);});api.localAiStatus().then(s=>{if(active)setAi(s);}).catch(e=>{if(active)setError(e.message);});const off=desktop?.onUpdate(s=>{if(active)setUpdate(s);});return()=>{active=false;off?.();};},[desktop]);
 const run=async fn=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);notify(e.message);}finally{pending.current=false;setBusy(false);}};
 return <>
 {error&&<p role="alert" className="reason">{error}</p>}
 <section className="card"><h3>SellQuanta Updates</h3><p>Update status: <b>{update.status}</b>{update.currentVersion&&<> · Installed version: <b>{update.currentVersion}</b></>}</p>
 {update.version&&<p>New version: <b>{update.version}</b></p>}{update.releaseNotes&&<pre className="settings-notes">{update.releaseNotes}</pre>}{update.error&&<p className="note">{update.error}</p>}
 {update.status==='downloading'&&<p role="status">Downloading verified update: {update.progress||0}%</p>}
 <div className="inline">{desktop&&<button className="ghost" disabled={busy||update.status==='downloading'} onClick={()=>void run(async()=>setUpdate(await desktop.checkForUpdates()))}>Check for Updates</button>}
 {desktop&&update.status==='available'&&<button disabled={busy} onClick={()=>void run(async()=>setUpdate(await desktop.downloadUpdate()))}>Download Update</button>}
 {desktop&&update.status==='downloaded'&&<button disabled={busy} onClick={()=>void run(async()=>desktop.installUpdate())}>Install and Close SellQuanta</button>}
 <a className="button-link" href={manual} target="_blank" rel="noopener noreferrer">Manual Windows Download</a></div>
 <p className="hint">Desktop builds check on startup and every six hours. Download and installation each require your confirmation. Finish saving work before installing. Sales, purchases, stock, banking, wallets and settings remain in their existing locations. Versions 1.0.2 and older need one manual upgrade to gain update support.</p></section>
 <section className="card"><h3>Optional Local AI (Ollama)</h3><p>Core business features and PDF text parsing work without Ollama. Local AI is optional for image labels that need a vision model.</p>
 {!ai?<p role="status">Checking installed software and local connection…</p>:<><div className="kv-line">Status: <b>{ai.status}</b>{ai.version&&<> · Ollama {ai.version}</>}</div><p>Configured vision model: <b>{ai.model}</b> · {ai.modelInstalled?'Installed':'Not installed'} · {ai.visionSupported?'Vision capability detected':'Vision capability not verified'}</p>
 <p className="hint">{ai.note}</p>{ai.error&&<p className="note">{ai.error}</p>}
 <div className="inline"><button className="ghost" disabled={busy} onClick={()=>void run(async()=>{setAi(await api.localAiStatus());notify('Local connection test completed; review the status and model capability.');})}>Test Connection</button>
 {ai.installed&&!ai.running&&<button disabled={busy} onClick={()=>void run(async()=>{if(!window.confirm('Start the installed Ollama service on this computer? It will listen on 127.0.0.1:11434 only. No model will be downloaded.'))return;setAi(await api.startLocalAi());})}>Start Installed Ollama</button>}
 <a href="https://ollama.com/download/windows" target="_blank" rel="noopener noreferrer">Official Ollama Windows Download</a></div>
 <h4>Setup guide</h4><ol><li>If Ollama is already installed, skip its installer. Open Ollama yourself or use the confirmed Start button above.</li><li>If it is not installed, download it from the official link and review its installation prompts. SellQuanta does not install it for you.</li><li>Download a vision model yourself only if you want AI scanning. Recommended starting model: <b>{ai.recommendation.model||'None for this PC; use Standard mode'}</b>.</li><li>For a compatible PC, run <code>ollama pull qwen2.5vl:3b</code> in your own terminal. This is an explicit 3.2 GB model download. SellQuanta never runs this command automatically.</li><li>Test Connection, then test a sample image shipping label in Daily Sales. Review parsed fields before saving; connection alone does not verify recognition accuracy.</li></ol>
 <p className="note">Detected RAM: {ai.recommendation.ramGB} GB. {ai.recommendation.note} Ollama requires at least 4 GB for installation, plus model storage and working space. Allow at least 12 GB free disk for the 3B setup. GPU drivers and available memory affect performance; CPU-only scanning may be slow. On 32 GB+ PCs, the 7B vision model is an optional 6.0 GB download; configure OLLAMA_MODEL before starting SellQuanta if choosing it.</p>
 <p className="hint">Keep Ollama on localhost. Do not change OLLAMA_HOST to 0.0.0.0, open firewall ports or forward router ports. <a href="https://docs.ollama.com/windows" target="_blank" rel="noopener noreferrer">Official Windows requirements</a></p></>}
 </section>
 </>;
}
