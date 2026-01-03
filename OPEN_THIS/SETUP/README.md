# ⚡ Quick Setup - One Command!

## 🚀 Automated Setup (Recommended)

Run the setup wizard to automatically detect your system:

```bash
node OPEN_THIS/SETUP/quick_setup.js
```

**What it does:**
- ✅ Auto-detects your IP address
- ✅ Finds MATLAB installation
- ✅ Finds Python installation
- ✅ Tests configuration
- ✅ Generates `setup_variable.json`

**Manual mode** (if auto-detection fails):
```bash
node OPEN_THIS/SETUP/quick_setup.js --manual
```

---

## 📋 What Gets Configured

The setup wizard creates `setup_variable.json` with these settings:

| Setting | What It Is | Example |
|---------|-----------|---------|
| `YOUR_IP_ADDRESS` | Your PC's local network IP | `192.168.1.100` |
| `SERVER_PORT` | Server port (default 3001) | `3001` |
| `MATLAB_PATH` | Full path to matlab.exe | `C:\Program Files\MATLAB\R2023b\bin\matlab.exe` |
| `PYTHON_PATH` | Full path to python.exe | `C:\Python313\python.exe` |

---

## 🔧 Manual Configuration (Advanced)

If you prefer to edit manually, update `setup_variable.json`:

```json
{
  "YOUR_IP_ADDRESS": "192.168.3.72",
  "SERVER_PORT": 3001,
  "MATLAB_PATH": "C:\\Program Files\\MATLAB\\R2023b\\bin\\matlab.exe",
  "PYTHON_PATH": "C:\\Python313\\python.exe"
}
```

**Find your IP:**
```bash
ipconfig
# Look for "IPv4 Address" under your network adapter
```

**Find Python path:**
```bash
where python
# Use the path that's NOT in WindowsApps
```

---

## ✅ After Setup

Start the server:
```bash
npm start
```

You should see:
```
✅ Configuration validated
🚀 Server running on http://YOUR_IP:3001
```

If you see configuration errors, run setup again:
```bash
node OPEN_THIS/SETUP/quick_setup.js
```

---

## 📱 Mobile App Connection

1. Ensure your phone is on the **same Wi-Fi** as your PC
2. Open the mobile app
3. Use the server URL: `http://YOUR_IP:3001`

---

## 🆘 Troubleshooting

**"MATLAB not found"**
- Run `node OPEN_THIS/SETUP/quick_setup.js` again
- Or manually set `MATLAB_PATH` in setup_variable.json

**"Python not found"**
- Install Python 3.7+ from python.org
- Run setup again

**"Configuration Error" on startup**
- Run: `node OPEN_THIS/SETUP/quick_setup.js`
- Check that MATLAB and Python paths exist

**Mobile app can't connect**
- Verify same Wi-Fi network
- Check IP address: `ipconfig`
- Verify port 3001 is not blocked by firewall
