# Antenna Optimizer

Antenna Optimizer is a desktop application that guides users through antenna tuning workflows using MATLAB + HFSS and then presents optimization and verification results in one UI.

---

## 1) System Requirements

For normal user operation (Windows desktop installer mode):

- Windows 10/11
- MATLAB (R2020b or newer recommended)
- Ansys Electronics Desktop / HFSS (compatible with your project)

Notes:

- The app asks you to confirm `matlab.exe` and `ansysedt.exe` on first launch.
- Python runtime is handled by the application in installer mode.

For source mode only:

- Run `npm install`
- Run `npm run setup` to generate/update setup configuration
- If auto-detection fails, run `node OPEN_THIS/SETUP/quick_setup.js --manual`

---

## 2) What You Do in the App (User Input)

Typical inputs from the user:

1. Select MATLAB project/script (usually `.mlx` workflow entry).
2. Select optimization variables (all variables or custom subset).
3. Configure ground plane:
   - Parametric mode (dimensions + position), or
   - DXF mode (upload DXF + position/alignment values).
4. Start run and monitor progress.
5. Review optimization and verification outputs.

---

## 3) Input Constraints You Must Respect

- MATLAB and HFSS paths must point to valid executable files.
- Project path must match expected optimization project structure.
- Ground-plane and position values must stay within physically valid design ranges.
- DXF files must pass app validation before simulation.
- During long runs, do not close required external tools/processes unexpectedly.

DXF validation rules used by the app:

- Minimum size: 25 mm × 25 mm
- Supported entities: POLYLINE, LWPOLYLINE, LINE, CIRCLE, ARC
- Cross/plus-style shapes must preserve enough center area for antenna placement

---

## 4) Full Antenna Tuning Flow

### Step A: Setup

1. Install and launch Antenna Optimizer.
2. Setup Wizard asks for:
   - `matlab.exe`
   - `ansysedt.exe`
3. Save setup and open main app.

### Step B: Design Preparation

1. Choose project/script.
2. Choose variables.
3. Set ground-plane (parametric or DXF).
4. Apply configuration.

### Step C: Run Optimization

1. Start run from app.
2. App backend orchestrates MATLAB + HFSS.
3. Progress/state updates stream in real time.

### Step D: Review Results

1. Open results pages after run finishes.
2. Inspect metrics and generated artifacts.
3. Use verification charts and summaries to judge design quality.

---

## 5) MATLAB/HFSS Execution Flow (What Happens Behind the UI)

1. UI sends run request to backend.
2. Backend prepares inputs (variables, GND config, project context).
3. MATLAB workflow executes and coordinates HFSS simulation sweeps.
4. MATLAB/Python helper processing produces charts + summaries.
5. Backend serves generated files/status back to the UI.

Short architecture view:

`UI (Electron + React/Expo) -> Node/Express backend -> MATLAB orchestrator -> HFSS solver -> result files -> UI`

---

## 6) What You Get from This Application

Expected outputs include:

- Optimization status and progression history
- Selected/best variable sets from optimization profile
- Verification visual outputs:
  - S11 chart
  - Axial Ratio chart
  - Gain chart
  - Smith chart
- Summary values around GPS L1 target (1.575 GHz)
- Saved run artifacts for traceability and handoff

---

## 7) Common Recovery Actions

- Setup fails: re-check `matlab.exe` and `ansysedt.exe` paths.
- Source mode setup fails: rerun `npm run setup` (or `node OPEN_THIS/SETUP/quick_setup.js --manual`).
- Run does not progress: stop run, validate project and geometry inputs, rerun.
- HFSS error/license issue: resolve solver/license availability, then retry.
- Port/process conflict: close stale MATLAB/HFSS/Node processes and restart app.

---

## 8) Need Technical/Developer Details?

See the developer documentation:

- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)

---

## Author

Mario Ma (https://github.com/Fkuzzl)
