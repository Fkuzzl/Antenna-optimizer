@echo off
REM Kill any Node processes (Expo + Node server)
for /f "tokens=2 delims=," %%i in ('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH') do (
    taskkill /F /PID %%~i >nul 2>&1
)

echo Servers stopped.
