const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;

function getProjectRoot() {
  return path.join(__dirname, '..');
}

function getServerEntry() {
  return path.join(getProjectRoot(), 'server', 'server.js');
}

function getWebEntry() {
  return path.join(getProjectRoot(), 'dist-web', 'index.html');
}

function startBackendServer() {
  if (serverProcess) return;

  const serverEntry = getServerEntry();
  const cwd = getProjectRoot();

  serverProcess = fork(serverEntry, [], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production'
    },
    stdio: 'inherit'
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[electron] Backend server exited with code ${code}`);
    }
    serverProcess = null;
  });
}

function stopBackendServer() {
  if (!serverProcess) return;
  try {
    serverProcess.kill('SIGTERM');
  } catch (error) {
    console.error('[electron] Failed to stop backend server:', error.message);
  } finally {
    serverProcess = null;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 750,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.ELECTRON_START_URL;

  if (devUrl) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  const webEntry = getWebEntry();
  try {
    await mainWindow.loadFile(webEntry);
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Startup Error',
      message: 'Failed to load desktop web bundle.',
      detail: `Expected file: ${webEntry}\n\nRun: npm run desktop:web:build`
    });
    app.quit();
  }
}

app.whenReady().then(async () => {
  startBackendServer();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackendServer();
});
