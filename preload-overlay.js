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
  /* for the Solver widget inside the overlay: the words in a picture, and the Word Problem Reader plugin */
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiDownload: () => ipcRenderer.invoke('ai:download'),
  aiCancel: () => ipcRenderer.send('ai:cancel'),
  onAiProgress: cb => ipcRenderer.on('ai:progress', (_e, p) => cb(p)),
  ocrImage: dataUrl => ipcRenderer.invoke('ocr:image', dataUrl),
  openSettings: () => { ipcRenderer.send('overlay:cancel'); ipcRenderer.send('settings:open'); }
});
