@echo off
REM Launch the Poolaris local server (serves the app + saves your data to a file).
cd /d "%~dp0"
echo Starting Poolaris...  (close this window to stop)
python server.py
pause
