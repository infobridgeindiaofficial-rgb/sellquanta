"use strict";
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('sellquantaDesktop',Object.freeze({
 getUpdateStatus:()=>ipcRenderer.invoke('sellquanta:update-status'),
 checkForUpdates:()=>ipcRenderer.invoke('sellquanta:update-check'),
 downloadUpdate:()=>ipcRenderer.invoke('sellquanta:update-download'),
 installUpdate:()=>ipcRenderer.invoke('sellquanta:update-install'),
 onUpdate:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('sellquanta:update-state',listener);return()=>ipcRenderer.removeListener('sellquanta:update-state',listener);}
}));
