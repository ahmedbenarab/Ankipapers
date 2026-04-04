@echo off
echo ============================================
echo   Building Ankipapers.ankiaddon
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_build.ps1"

echo.
echo ============================================
echo   Share this file with your friends.
echo   Install via Anki: Tools ^> Add-ons ^> Install from file...
echo ============================================
echo.
pause
