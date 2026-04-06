const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { fork, exec, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const net = require('net');

const defaultUserConfigPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Antenna Optimizer',
  'setup_variable.json'
);

const resolveElectronUserDataPath = () => {
  const rawPath = String(process.env.ELECTRON_USER_DATA_PATH || '').trim();
  if (!rawPath) return null;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
};

const electronUserDataPath = resolveElectronUserDataPath();
if (electronUserDataPath) {
  try {
    fs.mkdirSync(electronUserDataPath, { recursive: true });
    app.setPath('userData', electronUserDataPath);
  } catch (error) {
    console.error(`[electron] Failed to set userData path (${electronUserDataPath}):`, error.message);
  }
}

if (process.env.ELECTRON_DISABLE_GPU_CACHE === '1') {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-gpu-program-cache');
}

process.env.SETUP_CONFIG_PATH = process.env.SETUP_CONFIG_PATH || defaultUserConfigPath;

const setupConfig = require('../OPEN_THIS/SETUP/setup_loader');

let mainWindow = null;
let serverProcess = null;
let runtimeServerPort = 3001;
let setupWizardSession = null;

function getProjectRoot() {
  return path.join(__dirname, '..');
}

function detectBundledPythonPath() {
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'python-runtime', 'python.exe'));
  }

  const projectRoot = getProjectRoot();
  candidates.push(path.join(projectRoot, 'python-runtime', 'python.exe'));
  candidates.push(path.join(projectRoot, 'OPEN_THIS', 'SETUP', 'python-runtime', 'python.exe'));

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

function getServerEntry() {
  return path.join(getProjectRoot(), 'server', 'server.js');
}

function getUserSetupConfigPath() {
  return process.env.SETUP_CONFIG_PATH;
}

function getProjectPathsConfig() {
  const projectRoot = getProjectRoot();
  return {
    project_root: projectRoot,
    uploads_dir: path.join(projectRoot, 'uploads'),
    gnd_files_dir: path.join(projectRoot, 'uploads', 'gnd_files'),
    config_dir: path.join(projectRoot, 'config'),
    scripts_dir: path.join(projectRoot, 'scripts'),
    test_files_dir: path.join(projectRoot, 'test_files')
  };
}

function buildSetupConfig({ matlabPath, pythonPath, hfssPath, pythonMode = 'system', bundledPythonPath = '', systemPythonPath = '' }) {
  const host = '127.0.0.1';
  const port = 3001;
  const projectPaths = getProjectPathsConfig();
  const mode = pythonMode === 'bundled' ? 'bundled' : 'system';
  const selectedPythonPath = mode === 'bundled' ? bundledPythonPath : pythonPath;

  return {
    YOUR_IP_ADDRESS: host,
    SERVER_PORT: port,
    MATLAB_PATH: matlabPath,
    PYTHON_PATH: selectedPythonPath,
    config_version: '2.0.0',
    last_updated: new Date().toISOString().split('T')[0],
    matlab: {
      installation_paths: [matlabPath]
    },
    python: {
      mode,
      executable: selectedPythonPath,
      bundled_executable: bundledPythonPath || '',
      system_executable: systemPythonPath || pythonPath || ''
    },
    server: {
      host,
      port,
      websocket: {
        enabled: true,
        path: '/ws'
      }
    },
    expo: {
      port: 8081
    },
    hfss: {
      exe_path: hfssPath,
      process_names: [
        'ansysedt.exe',
        'anshfss.exe',
        'ansysli_server.exe',
        'ansysacad.exe',
        'maxwell.exe',
        'q3d.exe'
      ]
    },
    paths: projectPaths,
    network: {
      subnet: '127.0.0.x',
      allowed_origins: [
        `http://${host}:${port}`,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`
      ],
      cors_enabled: true
    },
    performance: {
      cache_ttl_ms: 1000,
      websocket_heartbeat_ms: 2000,
      status_polling_interval_ms: 3000
    }
  };
}

function validateSetupPaths({ matlabPath, pythonPath, hfssPath }) {
  const checks = [
    { value: matlabPath, expected: 'matlab.exe', label: 'MATLAB' },
    { value: hfssPath, expected: 'ansysedt.exe', label: 'HFSS' }
  ];

  for (const item of checks) {
    if (!item.value || !item.value.trim()) {
      throw new Error(`${item.label} path is required.`);
    }

    if (!fs.existsSync(item.value)) {
      throw new Error(`${item.label} path not found: ${item.value}`);
    }

    const name = path.basename(item.value).toLowerCase();
    if (name !== item.expected) {
      throw new Error(`${item.label} executable must be ${item.expected}`);
    }
  }

  if (!pythonPath || !pythonPath.trim()) {
    throw new Error('Python runtime is not available. Please reinstall the app.');
  }

  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Python runtime not found: ${pythonPath}`);
  }

  const pythonName = path.basename(pythonPath).toLowerCase();
  if (pythonName !== 'python.exe') {
    throw new Error('Python executable must be python.exe');
  }
}

function resolvePythonRuntime() {
  const bundledPythonPath = detectBundledPythonPath();
  if (bundledPythonPath) {
    return {
      pythonMode: 'bundled',
      pythonPath: bundledPythonPath,
      bundledPythonPath,
      systemPythonPath: detectPythonPath() || ''
    };
  }

  const systemPythonPath = detectPythonPath();
  if (systemPythonPath) {
    return {
      pythonMode: 'system',
      pythonPath: systemPythonPath,
      bundledPythonPath: '',
      systemPythonPath
    };
  }

  throw new Error('No Python runtime found. Packaged runtime is missing and no system Python was detected.');
}

function persistSetupConfig({ matlabPath, pythonPath, hfssPath, pythonMode, bundledPythonPath, systemPythonPath }) {
  const userConfigPath = getUserSetupConfigPath();
  const config = buildSetupConfig({
    matlabPath,
    pythonPath,
    hfssPath,
    pythonMode,
    bundledPythonPath,
    systemPythonPath
  });

  fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
  fs.writeFileSync(userConfigPath, JSON.stringify(config, null, 2), 'utf8');

  setupConfig.loaded = false;
  setupConfig.config = null;

  return userConfigPath;
}

function parseRequiredPythonPackages(requirementsPath) {
  if (!fs.existsSync(requirementsPath)) {
    return [
      { raw: 'pandas>=2.0.0', packageName: 'pandas' },
      { raw: 'numpy>=1.24.0', packageName: 'numpy' },
      { raw: 'openpyxl>=3.1.0', packageName: 'openpyxl' },
      { raw: 'ezdxf>=1.0.0', packageName: 'ezdxf' },
      { raw: 'python-dateutil>=2.8.0', packageName: 'python-dateutil' }
    ];
  }

  const content = fs.readFileSync(requirementsPath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((raw) => {
      const packageName = raw
        .split(/[<>=!~\s]/)[0]
        .trim()
        .toLowerCase();
      return { raw, packageName };
    });
}

function getImportNameFromPackage(packageName) {
  const mapping = {
    'python-dateutil': 'dateutil'
  };

  return mapping[packageName] || packageName.replace(/-/g, '_');
}

function ensurePythonRequirements(pythonPath, options = {}) {
  const mode = options?.pythonMode === 'bundled' ? 'bundled' : 'system';
  const requirementsPath = path.join(getProjectRoot(), 'OPEN_THIS', 'SETUP', 'requirements.txt');
  const packages = parseRequiredPythonPackages(requirementsPath);
  if (!packages.length) {
    return { checked: 0, installed: [], missingBeforeInstall: [] };
  }

  const importTargets = packages.map((pkg) => ({
    packageName: pkg.packageName,
    importName: getImportNameFromPackage(pkg.packageName)
  }));

  const checkScript = [
    'import json, importlib.util',
    `targets = ${JSON.stringify(importTargets)}`,
    'missing = [t["packageName"] for t in targets if importlib.util.find_spec(t["importName"]) is None]',
    'print(json.dumps({"missing": missing}))'
  ].join('; ');

  let missingBeforeInstall = [];
  try {
    const checkOutput = execSync(`"${pythonPath}" -c "${checkScript.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();

    const parsed = JSON.parse(checkOutput || '{}');
    missingBeforeInstall = Array.isArray(parsed?.missing) ? parsed.missing : [];
  } catch (error) {
    throw new Error(`Failed to verify Python libraries: ${error.message}`);
  }

  if (!missingBeforeInstall.length) {
    return { checked: packages.length, installed: [], missingBeforeInstall: [] };
  }

  if (mode === 'bundled') {
    throw new Error(
      `Bundled Python runtime is missing required libraries: ${missingBeforeInstall.join(', ')}. Rebuild the bundled runtime with OPEN_THIS/SETUP/requirements.txt.`
    );
  }

  const missingSet = new Set(missingBeforeInstall);
  const installTargets = packages
    .filter((pkg) => missingSet.has(pkg.packageName))
    .map((pkg) => pkg.raw);

  if (!installTargets.length) {
    return { checked: packages.length, installed: [], missingBeforeInstall };
  }

  try {
    execSync(`"${pythonPath}" -m pip install --disable-pip-version-check ${installTargets.join(' ')}`, {
      stdio: 'pipe',
      encoding: 'utf8'
    });
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`Failed to install Python libraries (${installTargets.join(', ')}). ${stderr || error.message}`);
  }

  return {
    checked: packages.length,
    installed: installTargets,
    missingBeforeInstall
  };
}

function detectMATLABPath() {
  const searchPaths = [
    'C:\\Program Files\\MATLAB',
    'C:\\Program Files (x86)\\MATLAB',
    'D:\\Program Files\\MATLAB',
    'D:\\MATLAB',
    'C:\\MATLAB'
  ];

  for (const matlabDir of searchPaths) {
    if (!fs.existsSync(matlabDir)) continue;
    try {
      const versions = fs.readdirSync(matlabDir).filter((v) => v.startsWith('R'));
      if (!versions.length) continue;
      const latest = versions.sort().reverse()[0];
      const exePath = path.join(matlabDir, latest, 'bin', 'matlab.exe');
      if (fs.existsSync(exePath)) return exePath;
    } catch {
      // ignore and continue
    }
  }

  try {
    const regQuery = execSync('reg query "HKLM\\SOFTWARE\\MathWorks\\MATLAB" /s /v MATLABROOT', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const lines = regQuery.split('\n');
    for (const line of lines) {
      if (!line.includes('MATLABROOT') || !line.includes('REG_SZ')) continue;
      const matlabRoot = line.split('REG_SZ')[1].trim();
      const exePath = path.join(matlabRoot, 'bin', 'matlab.exe');
      if (fs.existsSync(exePath)) return exePath;
    }
  } catch {
    // ignore
  }

  return '';
}

function detectPythonPath() {
  try {
    const result = execSync('where python', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const paths = result.trim().split('\n');
    for (const pythonPath of paths) {
      if (!pythonPath.toLowerCase().includes('windowsapps')) {
        return pythonPath.trim();
      }
    }
  } catch {
    // continue searching
  }

  const searchPaths = [
    'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310', 'C:\\Python39',
    'C:\\Program Files\\Python313', 'C:\\Program Files\\Python312', 'C:\\Program Files\\Python311',
    'D:\\Python313', 'D:\\Python312', 'D:\\Python311',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311')
  ];

  for (const pythonDir of searchPaths) {
    const exePath = path.join(pythonDir, 'python.exe');
    if (fs.existsSync(exePath)) return exePath;
  }

  return '';
}

function detectHFSSPath() {
  const candidates = [];
  const roots = [
    'C:\\Program Files\\AnsysEM',
    'C:\\Program Files (x86)\\AnsysEM',
    'D:\\Program Files\\AnsysEM',
    'D:\\AnsysEM'
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const versions = fs.readdirSync(root)
        .filter((v) => /^v\d+/i.test(v))
        .sort()
        .reverse();
      for (const version of versions) {
        candidates.push(path.join(root, version, 'Win64', 'ansysedt.exe'));
      }
    } catch {
      // ignore
    }
  }

  candidates.push('C:\\Program Files\\AnsysEM\\Win64\\ansysedt.exe');
  candidates.push('D:\\Program Files\\AnsysEM\\Win64\\ansysedt.exe');

  for (const exePath of candidates) {
    if (fs.existsSync(exePath)) return exePath;
  }

  return '';
}

function openSetupWizardWindow() {
  if (setupWizardSession) {
    return Promise.reject(new Error('Setup wizard is already running'));
  }

  const wizardHtmlPath = path.join(__dirname, 'setup-wizard.html');
  const wizardPreloadPath = path.join(__dirname, 'setupWizardPreload.js');

  if (!fs.existsSync(wizardHtmlPath)) {
    return Promise.reject(new Error(`Setup wizard UI file is missing: ${wizardHtmlPath}`));
  }

  if (!fs.existsSync(wizardPreloadPath)) {
    return Promise.reject(new Error(`Setup wizard preload file is missing: ${wizardPreloadPath}`));
  }

  const wizardWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    resizable: true,
    title: 'Antenna Optimizer Setup Wizard',
    autoHideMenuBar: true,
    modal: !!mainWindow,
    parent: mainWindow || undefined,
    show: false,
    backgroundColor: '#f3f6fb',
    webPreferences: {
      preload: wizardPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  wizardWindow.once('ready-to-show', () => {
    wizardWindow.show();
  });

  wizardWindow.webContents.on('did-fail-load', async (_event, errorCode, errorDescription, validatedURL) => {
    const detail = `Failed to load setup wizard window.\n\nCode: ${errorCode}\nReason: ${errorDescription}\nURL: ${validatedURL || '(none)'}`;
    console.error('[electron] Setup wizard failed to load', {
      errorCode,
      errorDescription,
      validatedURL,
      wizardHtmlPath,
      wizardPreloadPath
    });

    await dialog.showMessageBox({
      type: 'error',
      title: 'Setup Wizard Error',
      message: 'Unable to open setup wizard.',
      detail,
      buttons: ['Close'],
      noLink: true
    });

    if (!wizardWindow.isDestroyed()) {
      wizardWindow.close();
    }
  });

  return new Promise((resolve, reject) => {
    setupWizardSession = {
      window: wizardWindow,
      resolve,
      reject,
      finished: false,
      saved: false,
      savedConfigPath: ''
    };

    wizardWindow.on('closed', () => {
      if (setupWizardSession && !setupWizardSession.finished) {
        setupWizardSession.finished = true;
        if (setupWizardSession.saved) {
          const savedPath = setupWizardSession.savedConfigPath || getUserSetupConfigPath();
          setupWizardSession.resolve(savedPath);
          setupWizardSession = null;
          return;
        }
        setupWizardSession = null;
        reject(new Error('Setup cancelled by user'));
      }
    });

    wizardWindow.loadFile(wizardHtmlPath).catch(async (error) => {
      console.error('[electron] Failed to load setup wizard HTML', {
        error: error?.message || String(error),
        wizardHtmlPath,
        wizardPreloadPath
      });

      await dialog.showMessageBox({
        type: 'error',
        title: 'Setup Wizard Error',
        message: 'Unable to open setup wizard UI.',
        detail: `${error?.message || String(error)}\n\nUI path: ${wizardHtmlPath}\nPreload path: ${wizardPreloadPath}`,
        buttons: ['Close'],
        noLink: true
      });

      if (setupWizardSession && !setupWizardSession.finished) {
        setupWizardSession.finished = true;
        setupWizardSession = null;
      }

      if (!wizardWindow.isDestroyed()) {
        wizardWindow.close();
      }

      reject(error);
    });
  });
}

async function runSetupWizard() {
  return openSetupWizardWindow();
}

function registerDesktopIpcHandlers() {
  ipcMain.handle('setup-wizard:get-initial-data', () => {
    const setupConfigPath = getUserSetupConfigPath();

    let existingConfig = null;
    try {
      if (fs.existsSync(setupConfigPath)) {
        existingConfig = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
      }
    } catch {
      existingConfig = null;
    }

    return {
      matlabPath: existingConfig?.MATLAB_PATH || detectMATLABPath(),
      hfssPath: existingConfig?.hfss?.exe_path || detectHFSSPath(),
      setupConfigPath
    };
  });

  ipcMain.handle('setup-wizard:pick-file', async (_, payload) => {
    const picked = await dialog.showOpenDialog({
      title: payload?.title || 'Select executable',
      buttonLabel: payload?.buttonLabel || 'Select',
      properties: ['openFile'],
      defaultPath: payload?.defaultPath || undefined,
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (picked.canceled || !picked.filePaths?.length) {
      return { canceled: true, path: '' };
    }

    return { canceled: false, path: picked.filePaths[0] };
  });

  ipcMain.handle('setup-wizard:submit', async (_, payload) => {
    const matlabPath = (payload?.matlabPath || '').trim();
    const hfssPath = (payload?.hfssPath || '').trim();

    const runtime = resolvePythonRuntime();
    const pythonPath = runtime.pythonPath;
    const pythonMode = runtime.pythonMode;
    const bundledPythonPath = runtime.bundledPythonPath;
    const systemPythonPath = runtime.systemPythonPath;

    validateSetupPaths({ matlabPath, pythonPath, hfssPath });
    const pythonDeps = ensurePythonRequirements(pythonPath, { pythonMode });
    const configPath = persistSetupConfig({
      matlabPath,
      pythonPath,
      hfssPath,
      pythonMode,
      bundledPythonPath,
      systemPythonPath
    });

    if (setupWizardSession && !setupWizardSession.finished) {
      setupWizardSession.saved = true;
      setupWizardSession.savedConfigPath = configPath;
    }

    return {
      ok: true,
      path: configPath,
      pythonDependencies: pythonDeps
    };
  });

  ipcMain.handle('setup-wizard:finish', () => {
    if (setupWizardSession && !setupWizardSession.finished) {
      if (!setupWizardSession.saved) {
        throw new Error('Configuration is not saved yet.');
      }

      setupWizardSession.finished = true;
      const savedPath = setupWizardSession.savedConfigPath || getUserSetupConfigPath();
      setupWizardSession.resolve(savedPath);
      setupWizardSession.window.close();
      setupWizardSession = null;
      return { ok: true, path: savedPath };
    }

    return { ok: true, path: getUserSetupConfigPath() };
  });

  ipcMain.handle('setup-wizard:cancel', () => {
    if (setupWizardSession && !setupWizardSession.finished) {
      setupWizardSession.finished = true;
      setupWizardSession.reject(new Error('Setup cancelled by user'));
      setupWizardSession.window.close();
      setupWizardSession = null;
    }
    return { ok: true };
  });

  ipcMain.handle('desktop:getSetupConfigPath', () => getUserSetupConfigPath());
  ipcMain.handle('desktop:runSetupWizard', async () => {
    try {
      const configPath = await runSetupWizard();
      if (serverProcess) {
        stopBackendServer();
        startBackendServer();
      }
      return { ok: true, path: configPath };
    } catch (error) {
      return { ok: false, error: error.message || 'Setup wizard failed' };
    }
  });
}

function getWebEntry() {
  return path.join(getProjectRoot(), 'dist-web', 'index.html');
}

function getServerConfig() {
  try {
    const cfg = setupConfig.getServerConfig();
    const port = runtimeServerPort || cfg?.port || 3001;
    return {
      ...cfg,
      host: '127.0.0.1',
      port,
      url: `http://127.0.0.1:${port}`
    };
  } catch {
    const port = runtimeServerPort || 3001;
    return { host: '127.0.0.1', port, url: `http://127.0.0.1:${port}` };
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferredPort) {
  if (await isPortFree(preferredPort)) {
    return preferredPort;
  }

  for (let port = preferredPort + 1; port <= preferredPort + 30; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw new Error(`No available port found in range ${preferredPort}-${preferredPort + 30}`);
}

function waitForServerReady(url, timeoutMs = 30000) {
  const started = Date.now();
  const healthUrl = `${url}/health`;

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(healthUrl, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            retry();
            return;
          }

          try {
            const payload = JSON.parse(body || '{}');
            if (payload?.status === 'ok' && payload?.version) {
              resolve();
              return;
            }
          } catch {
            // ignore parse errors and retry
          }

          retry();
        });
      });

      req.on('error', retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for backend server at ${healthUrl}`));
        return;
      }
      setTimeout(tryOnce, 500);
    };

    tryOnce();
  });
}

function waitForDesktopRootReady(url, timeoutMs = 15000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          res.resume();
          resolve();
        } else {
          res.resume();
          retry();
        }
      });

      req.on('error', retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for desktop page at ${url}`));
        return;
      }
      setTimeout(tryOnce, 500);
    };

    tryOnce();
  });
}

async function ensureSetupConfigReady() {
  const userConfigPath = getUserSetupConfigPath();
  if (fs.existsSync(userConfigPath)) {
    return;
  }
  await runSetupWizard();
}

function startBackendServer() {
  if (serverProcess) return;

  const serverEntry = getServerEntry();
  const cwd = getProjectRoot();

  serverProcess = fork(serverEntry, [], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
      ELECTRON_DESKTOP: '1',
      SERVE_DIST_WEB: '1',
      PORT: String(runtimeServerPort),
      SERVER_PORT: String(runtimeServerPort),
      SETUP_CONFIG_PATH: getUserSetupConfigPath(),
      AO_LOG_DIR: path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'Antenna Optimizer',
        'logs'
      )
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
  const pid = serverProcess.pid;
  const processRef = serverProcess;
  try {
    if (process.platform === 'win32' && pid) {
      exec(`taskkill /PID ${pid} /T /F`, () => {});
    } else {
      processRef.kill('SIGTERM');
    }
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

  const serverConfig = getServerConfig();
  const desktopUrl = serverConfig?.url || 'http://127.0.0.1:3001';

  const webEntry = getWebEntry();
  try {
    if (!require('fs').existsSync(webEntry)) {
      throw new Error(`Missing desktop bundle: ${webEntry}`);
    }

    let lastLoadError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await waitForServerReady(desktopUrl, 30000);
        await waitForDesktopRootReady(desktopUrl, 15000);
        await mainWindow.loadURL(desktopUrl);
        lastLoadError = null;
        break;
      } catch (error) {
        lastLoadError = error;
        if (attempt < 3 && !process.env.ELECTRON_START_URL) {
          stopBackendServer();
          startBackendServer();
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
    }

    if (lastLoadError) {
      throw lastLoadError;
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Startup Error',
      message: 'Failed to start desktop app.',
      detail: `${error.message}\n\nDesktop URL: ${desktopUrl}\nExpected bundle: ${webEntry}\n\nAnother process may be occupying port 3001, or backend startup failed.`
    });
    app.quit();
  }
}

app.whenReady().then(async () => {
  try {
    registerDesktopIpcHandlers();
    await ensureSetupConfigReady();

    const configuredPort = Number(setupConfig.getServerConfig?.().port || 3001) || 3001;
    runtimeServerPort = await findAvailablePort(configuredPort);

    if (runtimeServerPort !== configuredPort) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Port Changed',
        message: `Port ${configuredPort} is busy.`,
        detail: `Using port ${runtimeServerPort} for this session.`,
        buttons: ['OK'],
        noLink: true
      });
    }

    if (!process.env.ELECTRON_START_URL) {
      startBackendServer();
    }
    await createWindow();
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Setup Required',
      message: 'Configuration was not completed.',
      detail: error.message || 'Setup wizard did not finish.',
      buttons: ['Close'],
      noLink: true
    });
    app.quit();
  }

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
