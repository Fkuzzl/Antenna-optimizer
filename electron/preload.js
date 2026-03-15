const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopEnv', {
  isElectron: true,
  platform: process.platform,
  getSetupConfigPath: () => ipcRenderer.invoke('desktop:getSetupConfigPath'),
  runSetupWizard: () => ipcRenderer.invoke('desktop:runSetupWizard'),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});
