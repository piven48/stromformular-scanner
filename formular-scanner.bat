@echo off
:: Windows: Doppelklick auf diese Datei startet den Formular-Scanner
cd /d "%~dp0"
echo Formular-Scanner wird gestartet...
node server.js
pause
