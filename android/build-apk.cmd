@echo off
rem Build APK (Trusted Web Activity) from the deployed site.
rem Usage: android\build-apk.cmd https://your-site.example
rem Needs Node.js and JDK 17.
setlocal
set "HOST=%~1"
if "%HOST%"=="" goto usage
set "HOST=%HOST:https://=%"
set "HOST=%HOST:/=%"
cd /d "%~dp0"
if not exist build mkdir build
cd build
node ..\make-manifest.js %HOST%
if errorlevel 1 exit /b 1
if not exist radf4.keystore keytool -genkeypair -alias radf4 -keyalg RSA -keysize 2048 -validity 10000 -keystore radf4.keystore -dname "CN=radf4"
call npx --yes @bubblewrap/cli update --manifest=twa-manifest.json --skipVersionUpgrade
call npx --yes @bubblewrap/cli build --skipPwaValidation
if errorlevel 1 exit /b 1
echo Done: android\build\app-release-signed.apk
exit /b 0
:usage
echo Usage: build-apk.cmd https://your-site.example
exit /b 1
