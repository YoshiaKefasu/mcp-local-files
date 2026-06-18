@echo off
setlocal

set "ROOT_FILE=%USERPROFILE%\mcp-local-files\root-dir.txt"

if exist "%ROOT_FILE%" (
  set /p ROOT_DIR=<"%ROOT_FILE%"
) else (
  set "ROOT_DIR=%USERPROFILE%\mcp-local-files"
)

cd /d "%USERPROFILE%\mcp-local-files"
node server.js
