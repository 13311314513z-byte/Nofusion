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

echo [NoFusion] Resolving pnpm...
call corepack pnpm --version >nul 2>nul
if not errorlevel 1 (
  set "PNPM=corepack"
  set "PNPM_ARGS=pnpm"
) else (
  where pnpm >nul 2>nul
  if not errorlevel 1 (
    set "PNPM=pnpm"
    set "PNPM_ARGS="
  ) else (
    if exist "%ROOT%\pnpm.cmd" (
      call "%ROOT%\pnpm.cmd" --version >nul 2>nul
    ) else (
      cmd /c exit 1
    )
    if not errorlevel 1 (
      set "PNPM=%ROOT%\pnpm.cmd"
      set "PNPM_ARGS="
    ) else (
      echo [NoFusion] ERROR: pnpm not found. Please install pnpm manually.
      echo [NoFusion] Run: corepack enable
      pause
      exit /b 1
    )
  )
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
  if defined PNPM_ARGS (
    call %PNPM% %PNPM_ARGS% install
  ) else (
    call "%PNPM%" install
  )
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

set "PATH=%ROOT%\node_modules\.bin;%PATH%"

start "" "%STUDIO_URL%"
if defined PNPM_ARGS (
  call %PNPM% %PNPM_ARGS% --filter @actalk/inkos-studio dev
) else (
  call "%PNPM%" --filter @actalk/inkos-studio dev
)

echo.
echo [NoFusion] Studio stopped.
pause
