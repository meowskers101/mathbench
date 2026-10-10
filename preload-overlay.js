'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mbOverlay', {
  init: () => ipcRenderer.invoke('overlay:init'),
  shown: () => ipcRenderer.send('overlay:shown'),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  setMode: m => ipcRenderer.send('overlay:mode', m),
  copyImage: d => ipcRenderer.send('overlay:copy', d),
  saveImage: d => ipcRenderer.send('overlay:save', d),
  solvePaste: d => ipcRenderer.send('overlay:solvepaste', d),
  scan: () => ipcRenderer.invoke('assist:scan'),
  solve: task => ipcRenderer.invoke('assist:solve', task),
  place: steps => ipcRenderer.send('assist:place', steps),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  openSettings: () => { ipcRenderer.send('overlay:cancel'); ipcRenderer.send('settings:open'); }
});
