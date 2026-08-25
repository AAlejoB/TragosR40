@echo off
chcp 65001 >nul
title PocketBase - Sistema de Tragos
cd /d "%~dp0pb"

if not exist "%~dp0pb\pocketbase.exe" goto falta

echo.
echo   ============================================
echo    Servidor del sistema de tragos
echo   ============================================
echo.
echo    Caja:      http://127.0.0.1:8090/caja.html
echo    Barra:     http://127.0.0.1:8090/barra.html
echo    Admin UI:  http://127.0.0.1:8090/_/
echo    Usuario:   admin@ruta40.local
echo.
echo    Deja esta ventana ABIERTA mientras lo usas.
echo    Para apagarlo: cerra la ventana o Ctrl+C
echo.

"%~dp0pb\pocketbase.exe" serve --http=0.0.0.0:8090 --publicDir="%~dp0web"

echo.
echo   El servidor se detuvo.
pause
exit /b 0

:falta
echo.
echo   ERROR: falta pocketbase.exe en la carpeta pb\
echo   Bajalo siguiendo las instrucciones de pb\README.md
echo.
pause
exit /b 1
