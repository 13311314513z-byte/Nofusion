@echo off
setlocal

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "STUDIO_URL=http://localhost:4577"
set "API_URL=http://localhost:4579"

title NoFusion Studio
cd /d "%ROOT%"

echo.
echo [NoFusion] Starting local Studio...
echo [NoFusion] Project root: %ROOT%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [NoFusion] ERROR: Node.js was not found in PATH.
  echo [NoFusion] Please install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if exist "%ROOT%\pnpm.cmd" (
  set "PNPM=%ROOT%\pnpm.cmd"
) else (
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo [NoFusion] pnpm was not found. Enabling Corepack...
    corepack enable
    if errorlevel 1 (
      echo [NoFusion] ERROR: Failed to enable Corepack.
      pause
      exit /b 1
    )
  )
  set "PNPM=pnpm"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $frontend = Invoke-WebRequest -UseBasicParsing '%STUDIO_URL%' -TimeoutSec 2; $api = Invoke-WebRequest -UseBasicParsing '%API_URL%/api/v1/project' -TimeoutSec 2; if ($frontend.StatusCode -ge 200 -and $api.StatusCode -ge 200) { exit 0 } exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo [NoFusion] Studio is already running.
  echo [NoFusion] Opening %STUDIO_URL%
  start "" "%STUDIO_URL%"
  exit /b 0
)

if not exist "%ROOT%\node_modules" (
  echo [NoFusion] Installing dependencies. This may take a while...
  call "%PNPM%" install
  if errorlevel 1 (
    echo [NoFusion] ERROR: Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [NoFusion] Frontend: %STUDIO_URL%
echo [NoFusion] API:      %API_URL%
echo.
echo [NoFusion] If ports 4577 or 4579 are already in use, close the old Studio window/process and run start.bat again.
echo [NoFusion] Press Ctrl+C in this window to stop Studio.
echo.

start "" "%STUDIO_URL%"
call "%PNPM%" --filter @actalk/inkos-studio dev

echo.
echo [NoFusion] Studio stopped.
pause
