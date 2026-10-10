# Disposable Windows runner only. Do not run against a user's existing installation.
$ErrorActionPreference = 'Stop'
$installer = (Get-ChildItem release/Milagre-Setup-*-x64.exe | Select-Object -First 1).FullName
if (!$installer) { throw 'NSIS candidate is missing' }
$destination = Join-Path $env:RUNNER_TEMP 'Milagre Installed Ω'
$executable = Join-Path $destination 'Milagre.exe'
$uninstaller = Join-Path $destination 'Uninstall Milagre.exe'
$profile = Join-Path $env:APPDATA 'Milagre'
if (Test-Path $profile) { throw 'Use a disposable runner without an existing Milagre profile' }
New-Item -ItemType Directory -Path $profile | Out-Null
$marker = Join-Path $profile 'nsis-preserve-fixture.txt'
Set-Content -Path $marker -Value 'Saved user data survives installer changes' -NoNewline
function Install-Candidate {
    $install = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', "/D=$destination") -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Installer exited $($install.ExitCode)" }
    if (!(Test-Path $executable) -or !(Test-Path $uninstaller)) { throw 'Installed payload or uninstaller is missing' }
    if ((Get-Content $marker -Raw) -ne 'Saved user data survives installer changes') { throw 'Installer changed saved user data' }
}
try {
    Install-Candidate
    node scripts/test-desktop.cjs --packaged $executable
    if ($LASTEXITCODE -ne 0) { throw 'Fresh installed desktop check failed' }
    # This synthetic ownership directory belongs only to this fixture. An
    # unreachable recorded host must block replacement instead of being killed.
    $blockedOwner = Join-Path $profile 'runtime.lock'
    if (Test-Path $blockedOwner) { throw 'Unexpected existing profile owner' }
    New-Item -ItemType Directory -Path $blockedOwner | Out-Null
    try {
        $blocked = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', "/D=$destination") -Wait -PassThru
        if ($blocked.ExitCode -eq 0) { throw 'Installer replaced files despite an unreachable recorded owner' }
        if (!(Test-Path $executable)) { throw 'Blocked installation removed the existing executable' }
    } finally {
        Remove-Item -Path $blockedOwner -Force
    }
    node scripts/verify-windows-installed-host.cjs start $executable
    if ($LASTEXITCODE -ne 0) { throw 'Installed host fixture failed' }
    Install-Candidate
    node scripts/verify-windows-installed-host.cjs stopped
    if ($LASTEXITCODE -ne 0) { throw 'Reinstall did not stop and save the previous host' }
    node scripts/test-desktop.cjs --packaged $executable
    if ($LASTEXITCODE -ne 0) { throw 'Reinstalled desktop check failed' }
    node scripts/verify-windows-installed-host.cjs start $executable
    if ($LASTEXITCODE -ne 0) { throw 'Uninstall host fixture failed' }
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited $($uninstall.ExitCode)" }
    # NSIS may hand off to its temporary uninstaller before Start-Process returns.
    $deadline = (Get-Date).AddSeconds(30)
    while ((Test-Path $executable) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (Test-Path $executable) { throw 'Uninstaller left the installed executable behind' }
    node scripts/verify-windows-installed-host.cjs stopped
    if ($LASTEXITCODE -ne 0) { throw 'Uninstall did not stop and save the previous host' }
    if ((Get-Content $marker -Raw) -ne 'Saved user data survives installer changes') { throw 'Uninstaller removed saved user data' }
    Write-Host 'PASS: NSIS fresh install, same-version reinstall and uninstall preserve user data'
} finally {
    Remove-Item -Path $profile -Recurse -Force
}
