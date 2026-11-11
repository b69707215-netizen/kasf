@echo off
chcp 65001 >nul
rem ==== ЗАПУСК КАРТИ ЗАГРОЗ ====
rem запускає локальний сервер і відкриває карту в браузері
start "" powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"
timeout /t 2 >nul
start "" "http://127.0.0.1:8802/index.html"
echo Карта запущена: http://127.0.0.1:8802/index.html
echo Вікно можна закрити (сервер працює у фоні).
timeout /t 3 >nul
