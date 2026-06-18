@echo off
setlocal
set "TARGET=%CD%"
if not "%~1"=="" set "TARGET=%~1"

echo %TARGET%> "%USERPROFILE%\mcp-local-files\root-dir.txt"
echo Local Files MCP ROOT_DIR is now:
type "%USERPROFILE%\mcp-local-files\root-dir.txt"
echo.
echo Restart tunnel-client run to apply this folder.
