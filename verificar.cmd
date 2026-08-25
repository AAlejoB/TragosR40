@echo off
chcp 65001 >nul
title Verificar schema - Sistema de Tragos
cd /d "%~dp0"

echo.
echo   Verificando el schema contra el servidor...
echo   (el servidor tiene que estar corriendo: arrancar.cmd)
echo.

node "%~dp0pb\verificar.mjs"

echo.
pause
