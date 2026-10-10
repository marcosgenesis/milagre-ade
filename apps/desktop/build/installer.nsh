# Stop the persistent host through its authenticated IPC before NSIS checks
# for remaining windows. Run the helper with the old installation's client,
# so a reinstall does not require a new flag in the previous executable.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=milagre-install-stop.cjs "${PROJECT_DIR}\apps\desktop\electron\install-stop.cjs"
    ReadEnvStr $2 "ELECTRON_RUN_AS_NODE"
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1") i.r0'
    nsExec::ExecToStack /TIMEOUT=65000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$PLUGINSDIR\milagre-install-stop.cjs" "$INSTDIR\resources\app.asar\node_modules\@milagre\daemon\src\client.cjs" "$APPDATA\Milagre"'
    Pop $0
    Pop $1
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t r2) i.r3'
    ${If} $0 != 0
      DetailPrint "Milagre could not save and stop its background host: $1"
      SetErrorLevel 1
      Abort "Close Milagre's background host before changing the installation. Saved data was kept."
    ${EndIf}
    SetOutPath "$INSTDIR"
  ${EndIf}
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
