@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 'Python 3.10 or later is required.')"
if errorlevel 1 goto failed
py -3 -c "from pathlib import Path; import hashlib; p=Path('airport_assessment_workbench-0.1.0-py3-none-any.whl'); expected='38c9fbdbaf76b51dc0e91c1625ff8624f98241017466d99160b70ea4d633ce30'; assert hashlib.sha256(p.read_bytes()).hexdigest()==expected, 'Wheel checksum differs; retain the file and contact support.'"
if errorlevel 1 goto failed
if not exist "airport-env\Scripts\python.exe" (
  py -3 -m venv "airport-env"
  if errorlevel 1 goto failed
)
"airport-env\Scripts\python.exe" -m pip install --no-index --no-deps "airport_assessment_workbench-0.1.0-py3-none-any.whl"
if errorlevel 1 goto failed
echo Installed. Run: start-windows.cmd
echo Then open http://127.0.0.1:8771
exit /b 0
:failed
echo Installation did not complete. Keep this message and see the operator guide.
exit /b 1
