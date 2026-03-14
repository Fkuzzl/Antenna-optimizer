const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopEnv', {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});
