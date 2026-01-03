@echo off
REM Automatically detect the project directory (parent of OPEN_THIS)
set "PROJECT_DIR=%~dp0.."
cd /d "%PROJECT_DIR%"

echo.
echo ========================================
echo   MATLAB Antenna Optimizer Launcher
echo ========================================
echo.
echo Project Directory: %PROJECT_DIR%
echo.

REM Start Expo terminal (will auto-close if server exits)
echo Starting Expo server...
start "Expo Development Server" cmd /c "cd /d %PROJECT_DIR% && npm start -- --clear"

REM Start Node server terminal (will auto-close if server exits)
echo Starting Node.js backend server...
start "Node.js Backend Server" cmd /c "cd /d %PROJECT_DIR% && npm run server"

REM Wait a few seconds for servers to initialize
echo.
echo Waiting 10 seconds for servers to initialize...
timeout /t 10 >nul

REM Open Expo development in browser
echo.
echo Opening Expo in browser...
start "" "http://localhost:8081"
echo.
echo ========================================
echo   Servers Started Successfully!
echo ========================================
echo.
echo Expo Server: http://localhost:8081
echo Backend Server: Check terminal window
echo.
echo Press any key to close this window...
pause >nul
