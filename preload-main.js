'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mbDesktop', {
  onCapture: cb => ipcRenderer.on('desktop:capture', (_e, d) => cb(d)),
  capture: () => ipcRenderer.send('capture:start'),
  assist: () => ipcRenderer.send('assist:start'),
  openSettings: () => ipcRenderer.send('settings:open'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: s => ipcRenderer.invoke('settings:save', s),
  onSolve: cb => ipcRenderer.on('desktop:solve', (_e, d) => cb(d)),
  solved: r => ipcRenderer.send('desktop:solved:' + r.id, r),
  /* Mathbench AI, the word-problem reader: downloaded once, on request */
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiDownload: () => ipcRenderer.invoke('ai:download'),
  aiCancel: () => ipcRenderer.send('ai:cancel'),
  onAiProgress: cb => ipcRenderer.on('ai:progress', (_e, p) => cb(p))
});
