# Electron Windows Branch Setup

This branch (`feature/electron-windows`) adds a Windows-first Electron wrapper while keeping Expo workflows unchanged.

## What this branch adds

- Electron main process in `electron/main.js`
- Electron preload in `electron/preload.js`
- Desktop scripts in `package.json`
- Electron Builder config (Windows target)

## Development mode (Windows)

Runs backend + Expo web + Electron together:

```bash
npm install
npm run desktop:dev
```

## Build web bundle only

```bash
npm run desktop:web:build
```

Output folder: `dist-web/`

## Package Windows installer

```bash
npm run desktop:pack:win
```

Output folder: `electron-dist/`

If you hit `Cannot create symbolic link ... winCodeSign` on Windows:

- Use the updated packaging script in this branch (it disables auto code-sign discovery).
- Run PowerShell as Administrator if your machine has strict symlink policy.
- Optional: Enable Windows Developer Mode to allow non-admin symlink creation.

## Notes

- This is **Windows-first** implementation as requested.
- Main branch can continue using Expo normally.
- Backend server is started by Electron process (fork of `server/server.js`).
- On first desktop launch, config is created at `%APPDATA%\\Antenna Optimizer\\setup_variable.json`.
- Desktop mode uses this user config path (via `SETUP_CONFIG_PATH`) and falls back to bundled config only if needed.
- If production app fails to load UI bundle, run `npm run desktop:web:build` first.
