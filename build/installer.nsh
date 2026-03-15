!macro CleanupPath targetPath label
  DetailPrint "Deleting ${label}: ${targetPath}"
  RMDir /r "${targetPath}"
  IfFileExists "${targetPath}" 0 +2
    DetailPrint "Warning: ${label} still exists (${targetPath})"
!macroend

!macro customUnInstall
  SetDetailsView show

  DetailPrint "Stopping Antenna Optimizer processes..."
  ExecWait 'taskkill /F /IM "Antenna Optimizer.exe" /T'
  ExecWait 'taskkill /F /IM "Antenna-Optimizer.exe" /T'
  ExecWait 'taskkill /F /IM "electron.exe" /T'
  ExecWait 'taskkill /F /IM "node.exe" /T'

  DetailPrint "Removing app data, cache, and logs..."
  !insertmacro CleanupPath "$APPDATA\Antenna Optimizer" "Roaming data"
  !insertmacro CleanupPath "$APPDATA\Antenna-optimizer" "Roaming data (legacy)"
  !insertmacro CleanupPath "$LOCALAPPDATA\Antenna Optimizer" "Local data"
  !insertmacro CleanupPath "$LOCALAPPDATA\Antenna-optimizer" "Local data (legacy)"
  !insertmacro CleanupPath "$TEMP\antenna-optimizer-logs" "Temporary logs"

  DetailPrint "Removing setup debug artifacts..."
  Delete "$TEMP\ao_setup_test.json"

  DetailPrint "Uninstall cleanup finished."
  IfSilent +2 0
  MessageBox MB_ICONINFORMATION|MB_OK "Antenna Optimizer uninstall cleanup finished. Review the uninstall details for any leftover folders that may require manual removal."
!macroend
