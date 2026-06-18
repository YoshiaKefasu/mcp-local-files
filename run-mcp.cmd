@echo off
setlocal

set "ROOT_FILE=%USERPROFILE%\mcp-local-files\root-dir.txt"

if exist "%ROOT_FILE%" (
  set /p ROOT_DIR=<"%ROOT_FILE%"
) else (
  set "ROOT_DIR=%USERPROFILE%\mcp-local-files"
)

set "MCP_DIR=%USERPROFILE%\mcp-local-files"

rem Export ROOT_DIR from the local cmd scope into the child node process.
rem Plain `set` keeps variables in this cmd's scope only, so we use
rem `endlocal & set` to leak the value into node.
rem Pass server.js by absolute path so this script does not need to cd first.
endlocal & set "ROOT_DIR=%ROOT_DIR%" & node "%MCP_DIR%\server.js"
