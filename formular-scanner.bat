@echo off
:: Windows: Doppelklick auf diese Datei startet den Formular-Scanner
cd /d "%~dp0"
echo Formular-Scanner wird gestartet...
set HEADLESS=0
node server.js
pause
