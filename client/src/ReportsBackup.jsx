import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Icon} from './icons';

export default function ReportsBackup() {
 const [info,setInfo]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const pending=useRef(false);
 useEffect(()=>{let active=true;Promise.resolve().then(()=>api.backupInfo()).then(result=>{if(active)setInfo(result);}).catch(()=>{});return ()=>{active=false;};},[]);
 const backupNow=async()=>{
  if(pending.current)return;pending.current=true;setBusy(true);setMessage('');setError('');
  try {const result=await api.backupNow();setMessage(`Backup saved: ${result.file}`);try{setInfo(await api.backupInfo());}catch{}}
  catch(failure){setError(failure.message||'Backup failed.');}
  finally {pending.current=false;setBusy(false);}
 };
 return <div className="card flush" aria-label="Data Backup">
  <div className="ph"><h3>Data Backup</h3><div className="acts"><button className="ghost" disabled={busy} onClick={backupNow}><Icon name="shield" size={15}/>{busy?'Backing up…':'Backup Now'}</button></div></div>
  <div className="pb">
   <p className="muted" style={{margin:0}}>Create a full backup using the existing local backups folder. Automatic daily backups keep the latest {info?.keepDays??30} days.</p>
   {info&&<p className="kv-line" style={{margin:'6px 0 0'}}><span>Automatic backups: <b>{info.dailyCount}</b></span><span>Manual backups: <b>{info.manualCount}</b> (backups/manual)</span></p>}
   {message&&<p className="field-note" role="status">{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
  </div>
 </div>;
}
