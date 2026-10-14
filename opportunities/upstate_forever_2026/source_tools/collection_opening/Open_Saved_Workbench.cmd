@echo off
call "%~dp0Open_Workbench.cmd" --plain %*
exit /b %errorlevel%
