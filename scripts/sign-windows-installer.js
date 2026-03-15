const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'electron-dist');

const certFile = (process.env.WIN_CERT_FILE || '').trim();
const certPassword = (process.env.WIN_CERT_PASSWORD || '').trim();
const certThumbprint = (process.env.WIN_CERT_SHA1 || '').trim();
const timestampUrl = (process.env.WIN_SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com').trim();
const signToolPath = (process.env.SIGNTOOL_PATH || 'signtool').trim();

function listInstallerCandidates() {
  if (!fs.existsSync(distDir)) return [];

  return fs
    .readdirSync(distDir)
    .filter((name) => /^Antenna-Optimizer-.*-Setup\.exe$/i.test(name))
    .map((name) => ({
      name,
      fullPath: path.join(distDir, name),
      mtime: fs.statSync(path.join(distDir, name)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

function hasSigningConfig() {
  return Boolean((certFile && certPassword) || certThumbprint);
}

function getSignerArgs(installerPath) {
  if (certFile && certPassword) {
    return `/f "${certFile}" /p "${certPassword}" /fd SHA256 /tr "${timestampUrl}" /td SHA256 "${installerPath}"`;
  }

  if (certThumbprint) {
    return `/sha1 "${certThumbprint}" /fd SHA256 /tr "${timestampUrl}" /td SHA256 "${installerPath}"`;
  }

  throw new Error('No valid signing configuration was provided.');
}

function main() {
  if (!hasSigningConfig()) {
    console.log('[desktop:sign:win] No signing configuration found; skipping code signing.');
    console.log('[desktop:sign:win] Set WIN_CERT_FILE + WIN_CERT_PASSWORD, or WIN_CERT_SHA1 to enable signing.');
    return;
  }

  const installers = listInstallerCandidates();
  if (!installers.length) {
    throw new Error('No installer EXE found in electron-dist. Build first with npm run desktop:pack:win:unsigned');
  }

  const target = installers[0].fullPath;
  const args = getSignerArgs(target);
  const command = `"${signToolPath}" sign ${args}`;

  console.log(`[desktop:sign:win] Signing installer: ${target}`);
  execSync(command, {
    stdio: 'inherit'
  });

  console.log('[desktop:sign:win] Signing completed successfully.');
}

try {
  main();
} catch (error) {
  console.error(`[desktop:sign:win] Failed: ${error.message || error}`);
  process.exit(1);
}
