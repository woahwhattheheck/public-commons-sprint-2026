@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Open this received project's existing native Windows operator.
set "ECOWB_ROOT=%~dp0."
set "ECOWB_ENTRY=%~dp0application\source_tools\open_workbench_windows.py"
set "PYTHONHOME="
set "PYTHONPATH="
if exist "%ECOWB_ENTRY%" goto entry_ready
set "ECOWB_ENTRY=%~dp0source_tools\open_workbench_windows.py"
if not exist "%ECOWB_ENTRY%" goto incomplete
:entry_ready
if defined ECOSYSTEMS_PYTHON goto ecosystem_python
if defined CODEX_PRIMARY_RUNTIME_PYTHON goto codex_python
if exist "%~dp0runtime\python.exe" goto supplied_python
where py.exe >nul 2>nul
if errorlevel 1 goto path_python
py.exe -3.12 -c "import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)" >nul 2>nul
if errorlevel 1 goto path_python
py.exe -3.12 -B "%ECOWB_ENTRY%" --project-directory "%ECOWB_ROOT%" %*
set "ECOWB_EXIT=%errorlevel%"
goto finished
:ecosystem_python
"%ECOSYSTEMS_PYTHON%" -B "%ECOWB_ENTRY%" --project-directory "%ECOWB_ROOT%" %*
set "ECOWB_EXIT=%errorlevel%"
goto finished
:codex_python
"%CODEX_PRIMARY_RUNTIME_PYTHON%" -B "%ECOWB_ENTRY%" --project-directory "%ECOWB_ROOT%" %*
set "ECOWB_EXIT=%errorlevel%"
goto finished
:supplied_python
"%~dp0runtime\python.exe" -B "%ECOWB_ENTRY%" --project-directory "%ECOWB_ROOT%" %*
set "ECOWB_EXIT=%errorlevel%"
goto finished
:path_python
where python.exe >nul 2>nul
if errorlevel 1 goto missing_python
python.exe -B "%ECOWB_ENTRY%" --project-directory "%ECOWB_ROOT%" %*
set "ECOWB_EXIT=%errorlevel%"
goto finished
:finished
if "%ECOWB_EXIT%"=="0" exit /b 0
echo.
echo Workbench opening stopped. The explanation above identifies the missing selection or file.
pause
exit /b %ECOWB_EXIT%
:incomplete
echo Keep this shortcut beside the complete project or its current application.
echo Missing application\source_tools\open_workbench_windows.py.
pause
exit /b 1
:missing_python
echo This Windows workbench needs the already installed Python 3.12.
echo Set ECOSYSTEMS_PYTHON to its full python.exe path, then reopen this shortcut.
echo The supplied Linux runtime cannot be used as Windows Python.
pause
exit /b 1
