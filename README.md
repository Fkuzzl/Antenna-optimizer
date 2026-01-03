# Antenna Optimizer - Interface for MATLAB Multi-Objective Evolutionary Algorithm Implementation

Automated antenna design optimization system using MATLAB-HFSS integration with real-time monitoring.

## Features

- **78-variable optimization** system for antenna design parameters
- **Real-time progress monitoring** via WebSocket
- **Cross-platform support** (iOS, Android, Web via Expo)
- **Custom ground plane import** import (DXF format)
- **Automated MATLAB-HFSS** integration

### Installation

**Step 1: Clone Repository**
```bash
git clone https://github.com/Fkuzzl/Antenna-optimizer.git
cd Antenna-optimizer
```

**Step 2: Install Prerequisites**

Ensure the following software is installed on your system:
- **Node.js** 18+ - [Download](https://nodejs.org/)
- **Python** 3.8+ - [Download](https://www.python.org/)
- **MATLAB** R2020b+ - [MathWorks](https://www.mathworks.com/)
- **HFSS** (Ansys Electronics Desktop before 2024 R2)

**Step 3: Run Setup**

Navigate to the `OPEN_THIS` folder and run the setup script:
```bash
cd OPEN_THIS
run_setup.bat
```

The setup wizard will:
- Detect your IP address and available ports
- Find MATLAB & Python installations
- Install required Python libraries (pandas, openpyxl, ezdxf, shapely)
- Generate configuration file (`setup_variable.json`)

**Step 4: Start Application**

After setup completes, run:
```bash
start_application.bat
```

This will:
- Start the Node.js server
- Open the application in your default browser
- Display the access URL (e.g., http://YOUR_IP:8081)

**Step 5: Stop Application**

To close all servers when finished:
```bash
stop_application_server.bat
```

This will terminate all Node.js processes (server and Expo).

## Usage

1. **Select Variables**: Choose optimization parameters (up to 78 variables)
2. **Configure Ground Plane**: Set dimensions and antenna position
3. **Run Optimization**: Execute MATLAB Live Script (.mlx file)
4. **Monitor Progress**: View real-time iteration updates via WebSocket
5. **View Results**: Access consolidated Excel reports

## Project Structure

```
├── app/                    # React Native frontend
├── server/                 # Node.js backend (Express + WebSocket)
├── scripts/                # Python utilities
├── config/                 # Variable definitions (78 parameters)
├── OPEN_THIS/SETUP/        # Auto-setup wizard
└── test_files/             # Sample DXF files
```

## Troubleshooting

**Setup fails to detect MATLAB/Python:**
```bash
node OPEN_THIS/SETUP/quick_setup.js --manual
```

**Port already in use:**
```bash
npm run kill-server
# Or edit OPEN_THIS/SETUP/setup_variable.json
```

**Python library errors:**
```bash
pip install -r OPEN_THIS/SETUP/requirements.txt
```

**Server won't start:**
- Verify `OPEN_THIS/SETUP/setup_variable.json` exists
- Run setup again: `npm run setup`

## Documentation

- **[DOCUMENTATION.md](DOCUMENTATION.md)** - Complete technical documentation
  - System architecture
  - API reference
  - WebSocket protocol
  - Performance metrics
  - Advanced configuration

## Technology Stack

- **Frontend**: React Native 0.81.4 + Expo ~54.0.10
- **Backend**: Node.js + Express 5.1.0
- **Real-time**: WebSocket (ws 8.18.3)
- **Data Processing**: Python 3.8+ (pandas, openpyxl)
- **Optimization**: MATLAB R2020b+ + HFSS 2022 R2

## Author
Mario Ma (https://github.com/Fkuzzl)
