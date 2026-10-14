@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Open the complete collection with its supplied Windows scientific runtime.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open_Workbench.ps1" %*
set "ECOWB_EXIT=%errorlevel%"
if "%ECOWB_EXIT%"=="0" exit /b 0
echo.
echo Workbench opening stopped. Keep the complete original collection together.
if not "%ECOWB_NO_PAUSE%"=="1" pause
exit /b %ECOWB_EXIT%
