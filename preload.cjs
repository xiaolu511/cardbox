const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getDataDir: () => ipcRenderer.invoke('data-dir:get'),
  chooseDataDir: () => ipcRenderer.invoke('data-dir:choose'),
  setDataDir: (dir) => ipcRenderer.invoke('data-dir:set', dir)
});