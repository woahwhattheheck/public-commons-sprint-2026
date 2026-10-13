@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem TokenJunkieLabs - open the same Linux workbench through existing WSL.
set "WORKBENCH_OPTION="
if "%~1"=="" goto selected
if "%~1"=="--no-browser" (
  set "WORKBENCH_OPTION=--no-browser"
  goto selected
)
if "%~1"=="--status" (
  set "WORKBENCH_OPTION=--status"
  goto selected
)
if "%~1"=="--help" goto help
echo Use no option, --no-browser, --status or --help.
exit /b 1
:selected
if not "%~2"=="" (
  echo Use only one opening option.
  exit /b 1
)
where wsl.exe >nul 2>nul
if errorlevel 1 goto missing
wsl.exe --exec /bin/sh -c "exit 0" >nul 2>nul
if errorlevel 1 goto missing
set "WORKBENCH_WIN_ROOT=%~dp0."
set "WSLENV=%WSLENV%:WORKBENCH_WIN_ROOT/p"
echo Opening this original project in the existing Linux environment.
echo The original session will open in your Windows browser.
echo If automatic opening is unavailable, use its private address on this PC.
echo Keep this window open while using the workbench.
wsl.exe --exec /bin/sh -s -- %WORKBENCH_OPTION% < "%~dp0application\source_tools\open_workbench_wsl.sh"
set "WORKBENCH_EXIT=%errorlevel%"
if not "%WORKBENCH_EXIT%"=="0" pause
exit /b %WORKBENCH_EXIT%
:missing
echo This package needs an existing running Linux x86_64 WSL distribution.
echo Its scientific runtime does not run in ordinary Windows Python.
echo Open the complete package in the supported Linux environment.
echo This shortcut does not install WSL or download anything.
pause
exit /b 1
:help
echo Open_Workbench_WSL.cmd opens this same project through existing WSL.
echo Options: --no-browser or --status. The private address opens in your Windows browser.
exit /b 0
