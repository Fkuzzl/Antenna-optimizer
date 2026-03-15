const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronDist = path.join(projectRoot, 'electron-dist');
const winUnpacked = path.join(electronDist, 'win-unpacked');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryKillWindowsProcesses() {
  if (process.platform !== 'win32') return;

  const processNames = [
    'electron.exe',
    'Antenna Optimizer.exe',
    'Antenna-Optimizer.exe',
    '7za.exe',
    'app-builder.exe'
  ];

  for (const processName of processNames) {
    try {
      execSync(`taskkill /F /IM "${processName}" /T`, { stdio: 'ignore' });
    } catch {
      // ignore - process may not be running
    }
  }
}

async function removeDirWithRetry(targetPath, attempts = 8) {
  if (!fs.existsSync(targetPath)) return;

  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200
      });
      return;
    } catch (error) {
      lastError = error;
      tryKillWindowsProcesses();
      await sleep(300 * i);
    }
  }

  throw lastError;
}

async function main() {
  console.log('[desktop:clean] Preparing build output directories...');
  tryKillWindowsProcesses();

  await removeDirWithRetry(winUnpacked);

  if (!fs.existsSync(electronDist)) {
    fs.mkdirSync(electronDist, { recursive: true });
  }

  console.log('[desktop:clean] Done.');
}

main().catch((error) => {
  console.error('[desktop:clean] Failed:', error.message || error);
  process.exit(1);
});
