# MOEA Verification MATLAB Handoff (App ↔ Server ↔ MATLAB)

This document is the **implementation contract** for MATLAB-side verification logic.
Use it directly in AI chat inside the MATLAB project directory.

---

## 1) Goal

From MOEA Profile Viewer, user selects one solution:
- `balanced` or
- `optimal`

Then app triggers a **full HFSS frequency sweep verification** and shows:
- `chart_s11.png`
- `chart_ar.png`
- `chart_gain.png`
- `chart_smith.png`
- summary values at GPS L1 (1.575 GHz)

Verification MATLAB logic must be under:
- `MOEA_D_DE_3obj_current/Function/VERIFICATION`

---

## 2) Current End-to-End Flow

## 2.1 App flow (MoeaProfileViewer)

File: `app/MoeaProfileViewer.jsx`

1. App loads profiles:
- `GET /api/integrated-results/profiles?projectPath=<projectDir>`

2. App loads one profile:
- `GET /api/integrated-results/profiles/:profileId?projectPath=<projectDir>`

3. User clicks verification button on `balanced` or `optimal` card:
- `POST /api/integrated-results/profiles/:profileId/verify`
- Body:
```json
{
  "projectPath": "C:/.../MOEA_D_DE_3obj_current",
  "solutionType": "balanced"
}
```

4. App polls status every 5s:
- `GET /api/integrated-results/profiles/:profileId/verify-status?projectPath=...&runId=...`

5. Once status is `completed`, app loads images with:
- `GET /api/integrated-results/profiles/:profileId/verify-chart/chart_s11.png?...`
- `GET /.../chart_ar.png?...`
- `GET /.../chart_gain.png?...`
- `GET /.../chart_smith.png?...`

---

## 2.2 Server flow

Files:
- `server/routes/results.js`
- `server/services/moeaVerificationManager.js`
- `server/services/moeaProfileManager.js`

### Route contracts

### Start verification
`POST /api/integrated-results/profiles/:profileId/verify`

Request body:
```json
{
  "projectPath": "<absolute project dir or file path>",
  "solutionType": "balanced|optimal"
}
```

Success response:
```json
{
  "success": true,
  "message": "Verification started",
  "data": {
    "runId": "verify_balanced_1710000000000",
    "outputDir": "C:\\...\\Function\\VERIFICATION\\Results\\verify_balanced_...",
    "solutionType": "balanced",
    "profileId": "profile_..."
  }
}
```

### Poll status
`GET /api/integrated-results/profiles/:profileId/verify-status?projectPath=...&runId=...`

Success payload is passthrough from `verification_status.json` + `runId` + `outputDir`.

### Fetch chart image
`GET /api/integrated-results/profiles/:profileId/verify-chart/:chartName?projectPath=...&runId=...`

Allowed chart names only:
- `chart_s11.png`
- `chart_ar.png`
- `chart_gain.png`
- `chart_smith.png`

---

## 2.3 Server-to-MATLAB invocation

Server spawns MATLAB batch:
```text
matlab -batch "cd('<projectDir>'); addpath(genpath(fullfile('<projectDir>','Function','VERIFICATION'))); MOEA_Verification_Run('<outputDir>','<solutionType>','<profileSnapshotPath>')"
```

Where:
- `profileSnapshotPath` = `Function/VERIFICATION/Results/<runId>/profile_snapshot.json`
- Profile snapshot contains full profile data (optimalResults, gndSetting, antennaPosition, variable values)

---

## 3) Profile Input Data Available to MATLAB

From `profile_snapshot.json`:

```json
{
  "profileId": "profile_...",
  "projectDir": "C:/.../MOEA_D_DE_3obj_current",
  "optimalResults": {
    "balanced": {
      "iteration": 123,
      "s11": [...],
      "ar": [...],
      "gain": [...],
      "variableValues": [
        {"name":"probex","value":3.54,"unit":"mm"},
        {"name":"orange","value":35,"unit":"deg"}
      ]
    },
    "optimal": {
      "iteration": 141,
      "variableValues": [...]
    }
  },
  "gndSetting": {
    "mode": "parametric|dxf",
    "Lgx": 100,
    "Lgy": 100,
    "GND_xPos": 12.5,
    "GND_yPos": 12.5,
    "filePath": "C:/.../xxx.dxf"
  },
  "antennaPosition": {"x":12.5,"y":12.5}
}
```

Important: `variableValues` already comes from iteration VBScript parse on server side.

---

## 4) MATLAB Implementation Requirements

Create these files in MATLAB project:

- `Function/VERIFICATION/MOEA_Verification_Run.m` (entry)
- Optional helpers under `Function/VERIFICATION/Helpers/`

Reuse EARLY_PHASE modules:
- `Function/EARLY_PHASE/Simulation/EP_HFSS_Wrapper.m`
- `Function/EARLY_PHASE/Helpers/Generate_Smith_Chart.m`
- `Function/EARLY_PHASE/Config/EP_Config.json`

### Required function signature

```matlab
function MOEA_Verification_Run(output_dir, solution_type, profile_json_path)
```

### Required behavior

1. Read `profile_json_path`.
2. Pick `selected = profile.optimalResults.(solution_type)`.
3. Build antenna variable struct from `selected.variableValues`.
4. Build GND config from `profile.gndSetting` + `profile.antennaPosition`.
5. Load HFSS config from `Function/EARLY_PHASE/Config/EP_Config.json`.
6. Run full sweep using `EP_HFSS_Wrapper` with at least GPS L1 range coverage.
   - Current server scaffold uses `1.40` to `1.80` GHz.
7. Generate required 4 PNG charts with exact names.
8. Write summary JSON and status JSON.

---

## 5) Required Output Files (contract)

Under:
- `Function/VERIFICATION/Results/<runId>/`

Must create:
- `verification_status.json`
- `verification_summary.json`
- `chart_s11.png`
- `chart_ar.png`
- `chart_gain.png`
- `chart_smith.png`

Optional but recommended:
- raw CSV exports (`S11_*.csv`, `AR_*.csv`, `Gain_*.csv`, `Smith_*.csv`)

---

## 6) Status JSON Contract

File: `verification_status.json`

### During run
```json
{
  "status": "running",
  "message": "Running full GPS L1 sweep in HFSS...",
  "started_at": "2026-03-19 14:30:00",
  "solution_type": "balanced"
}
```

### Completed
```json
{
  "status": "completed",
  "message": "Verification run completed",
  "started_at": "...",
  "completed_at": "...",
  "solution_type": "balanced",
  "summary": {
    "solution_iteration": 123,
    "freq_s11": 1.575,
    "s11_1575": -15.2,
    "freq_ar": 1.575,
    "ar_1575": 1.9,
    "freq_gain": 1.575,
    "gain_1575": 3.1
  },
  "charts": ["chart_s11.png","chart_ar.png","chart_gain.png","chart_smith.png"]
}
```

### Error
```json
{
  "status": "error",
  "message": "<error text>",
  "completed_at": "..."
}
```

---

## 7) Summary JSON Contract

File: `verification_summary.json`

```json
{
  "solution_iteration": 123,
  "freq_s11": 1.575,
  "s11_1575": -15.2,
  "freq_ar": 1.575,
  "ar_1575": 1.9,
  "freq_gain": 1.575,
  "gain_1575": 3.1
}
```

This is what app shows in “Verification Result”.

---

## 8) Variable + GND Mapping Rules

### Variables
- Source = `selected.variableValues` array.
- Build struct fields expected by `EP_HFSS_Wrapper`, typically:
  - `probex`, `purple`, `ngreen`, `orange`, `orange2`, `brown`, `bluel`
- If missing, fill with safe defaults from `EP_Config` defaults.

### GND
- If `gndSetting.mode == 'dxf'` and `gndSetting.filePath` exists:
  - `gnd.use_DXF = true`
  - `gnd.dxf_file_path = gndSetting.filePath`
- Else parametric:
  - `gnd.use_DXF = false`
  - `gnd.Lgx`, `gnd.Lgy`
  - `gnd.xPos`, `gnd.yPos` from `antennaPosition` if present, else `GND_xPos/GND_yPos`

---

## 9) Frequencies and Charts

Minimum expected:
- Sweep range covering GPS L1 around 1.575 GHz
- Chart includes marker/reference at 1.575 GHz

Current scaffold default sweep:
- Start `1.40 GHz`
- Stop `1.80 GHz`
- Setup `Setup1`
- Sweep `Sweep`

---

## 10) Failure Handling Required

- Always write `verification_status.json` on error (`status = error`).
- Do not silently fail if HFSS CSV missing.
- Keep error message concise and actionable.

---

## 11) Suggested MATLAB AI Prompt (copy/paste)

```text
I need you to fully implement MOEA verification logic in this MATLAB project.

Context:
- Project root is MOEA_D_DE_3obj_current.
- Verification entrypoint must be Function/VERIFICATION/MOEA_Verification_Run.m
- Function signature: MOEA_Verification_Run(output_dir, solution_type, profile_json_path)
- Use EARLY_PHASE simulation stack where possible:
  - Function/EARLY_PHASE/Simulation/EP_HFSS_Wrapper.m
  - Function/EARLY_PHASE/Helpers/Generate_Smith_Chart.m
  - Function/EARLY_PHASE/Config/EP_Config.json

Required behavior:
1) Read profile JSON snapshot from profile_json_path.
2) Pick selected solution from profile.optimalResults.(solution_type), where solution_type is balanced or optimal.
3) Build variable struct from selected.variableValues and map names/units to numeric values.
4) Build GND config from profile.gndSetting + profile.antennaPosition.
5) Run full HFSS sweep (at least covers 1.575 GHz) via EP_HFSS_Wrapper.
6) Generate exactly these files in output_dir:
   - chart_s11.png
   - chart_ar.png
   - chart_gain.png
   - chart_smith.png
   - verification_summary.json
   - verification_status.json
7) verification_status.json must update from running to completed/error.
8) verification_summary.json must include:
   - solution_iteration
   - freq_s11, s11_1575
   - freq_ar, ar_1575
   - freq_gain, gain_1575
9) On any error, write verification_status.json with status=error and message.

Please create any helper functions under Function/VERIFICATION/Helpers and ensure the entrypoint is callable from MATLAB -batch.
```

---

## 12) Notes / Current Gap

- Current server code writes a scaffold `MOEA_Verification_Run.m` automatically.
- Replace that scaffold with your full MATLAB implementation in `Function/VERIFICATION`.
- Keep output filenames and JSON keys exactly as above so app and server continue to work unchanged.
