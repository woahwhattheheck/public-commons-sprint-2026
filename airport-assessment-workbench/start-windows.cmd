@echo off
setlocal
if not exist "%~dp0airport-env\Scripts\python.exe" (
  echo Run install-windows.cmd first.
  exit /b 1
)
"%~dp0airport-env\Scripts\python.exe" -m airport_operator --workspace "%~dp0airport-workspace" --demo --port 8771 %*
exit /b %errorlevel%
