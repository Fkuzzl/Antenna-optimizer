# Developer Guide

This guide is for maintainers who will continue development, debugging, and release packaging of Antenna Optimizer.

---

## 1) Stack and Libraries Used

### Frontend / Desktop UI

- React Native + Expo (web target for desktop shell UI)
- React / React DOM
- Electron (desktop runtime)
- `expo-router`
- `expo-*` modules (document picker, file system, status bar, etc.)

### Backend

- Node.js + Express
- WebSocket (`ws`)
- `multer` for upload handling
- `winston` for logging
- `xlsx` for Excel handling

### Orchestration / Processing

- MATLAB + HFSS for simulation and optimization execution
- Python scripts under `scripts/` for data and export utilities

### Build / Packaging

- `electron-builder` (NSIS installer)
- `cross-env`
- `concurrently`
- `wait-on`

---

## 2) Repository Areas You Will Touch Most

- `app/` → React/Expo pages and UI flow
- `server/` → API routes, orchestration services, run management
- `electron/` → Electron main process, preload, setup wizard
- `scripts/` → Python helper scripts
- `config/` → variable/system JSON configs
- `build/installer.nsh` → NSIS installer customization

---

## 3) Developer Prerequisites

- Windows 10/11 (primary supported development target)

- [ ] Install required tools:
    - npm
	- HFSS / Ansys Electronics Desktop (version before 2024 R1, go taobao buy crack for $20HKD)
	- MATLAB (2023b is currently used; newer versions can be evaluated)
	- Node.js 18+
	- Python

Install JS dependencies first:

```bash
npm install
```

Run setup:

```bash
npm run setup
```

---

## 4) Run Electron in Development Mode

Use one command to launch backend + Expo web + Electron:

```bash
npm run desktop:dev
```

What it does:

1. Starts backend server (`npm run server`) on port 3001.
2. Starts Expo web dev server on `localhost:8081`.
3. Waits for servers to be ready, then opens Electron with `ELECTRON_START_URL`.

If needed:

- Kill stale Node processes:

```bash
npm run kill-server
```

---

## 5) Build and Package to Windows Installer (.exe)

### Build web bundle used by Electron packaging

```bash
npm run desktop:web:build
```

### Create unsigned installer

```bash
npm run desktop:pack:win:unsigned
```

### Create installer with optional signing step

```bash
npm run desktop:pack:win
```

Output location:

- `electron-dist/`

---

## 6) Optional Code Signing for Installer

Set one signing mode before `desktop:pack:win`.

### PFX mode

```powershell
$env:WIN_CERT_FILE='C:\path\to\codesign.pfx'
$env:WIN_CERT_PASSWORD='your-password'
```

### Thumbprint mode

```powershell
$env:WIN_CERT_SHA1='YOUR_CERT_THUMBPRINT'
```

Optional overrides:

```powershell
$env:SIGNTOOL_PATH='C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe'
$env:WIN_SIGN_TIMESTAMP_URL='http://timestamp.digicert.com'
```

---

## 7) Daily Dev Commands (Quick Reference)

```bash
npm run setup
npm run desktop:dev
npm run desktop:web:build
npm run desktop:pack:win:unsigned
npm run desktop:pack:win
```

---

## 8) Maintenance Notes for Future Owners

- Keep API contracts stable for app pages already in production.
- Treat `server/services/*Manager.js` files as orchestration core.
- Keep MATLAB output file names/contracts unchanged where UI depends on exact chart names.
- Regenerate web bundle (`desktop:web:build`) before packaging Electron builds.
- Avoid committing generated runtime directories or logs.

---

## 9) Troubleshooting

### Electron dev window does not open

- Ensure ports are free and `desktop:dev` completed server startup.
- Check terminal output for `wait-on` timeout errors.

### Backend starts but app fails requests

- Confirm API is reachable at `http://localhost:3001`.
- Validate setup config exists and paths are valid.

### Packaging fails

- Run `npm run desktop:clean` then retry pack commands.
- Ensure `dist-web/` is generated.
- Re-check Windows signing environment variables if signing is enabled.

---

## 10) Documentation Policy

This repository intentionally keeps only two root docs:

1. `README.md` (normal users)
2. `DEVELOPER_GUIDE.md` (maintainers/developers)

---

## 11) Project To-Do Checklist

- [ ] Ensure port `3001` is available before starting the Node.js backend server.
- [ ] test_files used for import GND design, dxf format 2D design only***
- [ ] Before active application work, tune HFSS variables one-by-one to understand result sensitivity per variable.
- [ ] Use AI assistance to explain each file by directory when onboarding or reviewing code.

- Good luck
