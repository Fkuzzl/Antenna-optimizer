const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupWizard', {
  getInitialData: () => ipcRenderer.invoke('setup-wizard:get-initial-data'),
  pickFile: (payload) => ipcRenderer.invoke('setup-wizard:pick-file', payload),
  submit: (payload) => ipcRenderer.invoke('setup-wizard:submit', payload),
  finish: () => ipcRenderer.invoke('setup-wizard:finish'),
  cancel: () => ipcRenderer.invoke('setup-wizard:cancel')
});
