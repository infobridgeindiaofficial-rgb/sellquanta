"use strict";
const {verifyManifest,verifyNativeInfo,verifyInstaller}=require('./updateTrust.cjs');
const MANUAL_URL='https://infobridgeindia.online/sellquanta/download.html';
const MANIFEST_URL='https://infobridgeindia.online/sellquanta-updates/latest.json';
function createUpdateManager({updater,publicKey,currentVersion,fetchManifest,onChange=()=>{},onAvailable=()=>{},install,intervalMs=6*60*60*1000}){
 let state={status:'idle',currentVersion,manualUrl:MANUAL_URL},trusted=null,downloaded=null,busy=false,timer=null,lastUpdaterError=null;
 const change=patch=>{state={...state,...patch};onChange({...state});};
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableWebInstaller=true;
 // Full NSIS downloads avoid mixing cached blockmaps from the older manual releases.
 updater.disableDifferentialDownload=true;
 updater.requestHeaders={...updater.requestHeaders,'x-user-staging-id':''};
 updater.on('download-progress',p=>change({progress:Math.round(p.percent)}));
 updater.on('error',error=>{lastUpdaterError=error;if(!busy)change({status:'error',error:error.message});});
 const check=async()=>{if(busy||state.status==='downloaded')return {...state};busy=true;try{
  change({status:'checking',error:null});trusted=verifyManifest(await fetchManifest(),publicKey,currentVersion);
  if(trusted.version===currentVersion){change({status:'current',version:null,releaseNotes:null});return {...state};}
  const result=await updater.checkForUpdates();verifyNativeInfo(result?.updateInfo,trusted);
  change({status:'available',version:trusted.version,releaseNotes:trusted.releaseNotes,releaseDate:trusted.releaseDate});onAvailable({...state});
 }catch(e){trusted=null;downloaded=null;change({status:'error',error:e.message});}finally{busy=false;}return {...state};};
 const download=async()=>{if(busy||state.status!=='available'||!trusted)throw Error('Check for a verified update before downloading.');busy=true;try{
  change({status:'downloading',progress:0});const files=await updater.downloadUpdate();downloaded=files?.[0];if(!downloaded)throw Error('Installer was not downloaded.');
  await verifyInstaller(downloaded,trusted);change({status:'downloaded',progress:100});
 }catch(e){downloaded=null;change({status:'error',error:e.message});throw e;}finally{busy=false;}return {...state};};
 const apply=async()=>{if(busy||state.status!=='downloaded'||!trusted||!downloaded)throw Error('Download and verify an update before installing.');busy=true;try{await verifyInstaller(downloaded,trusted);await install(()=>{lastUpdaterError=null;updater.quitAndInstall(false,true);if(lastUpdaterError)throw lastUpdaterError;});}catch(e){change({status:'error',error:e.message});throw e;}finally{busy=false;}};
 return {check,download,apply,getState:()=>({...state}),start(){void check();timer=setInterval(()=>void check(),intervalMs);timer.unref?.();},stop(){if(timer)clearInterval(timer);}};
}
async function fetchSignedManifest(){
 const r=await fetch(MANIFEST_URL,{signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
 if(!r.ok)throw Error(`Update service unavailable (${r.status}). Use the manual download link.`);
 const text=await r.text();if(Buffer.byteLength(text)>64000)throw Error('Update metadata is too large.');return JSON.parse(text);
}
module.exports={createUpdateManager,fetchSignedManifest,MANUAL_URL,MANIFEST_URL};
