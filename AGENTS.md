# AGENTS.md

Guidance for Codex and other coding agents working in `%USERPROFILE%\mcp-local-files`.

## Project purpose

This folder contains a minimal local-files MCP server for ChatGPT/Codex. It allows the model to access exactly one local folder through OpenAI Secure MCP Tunnel. The active target folder is read from `root-dir.txt` by `run-mcp.cmd` and passed to `server.js` as `ROOT_DIR`.

The goal is practical local project assistance: list files, read text files, search text files, write new text files, and safely replace exact text in files.

## Important files

```text
server.js       Main MCP stdio server. Keep this simple and dependency-light.
cli.js          npm CLI wrapper, ROOT_DIR helper, and tunnel-client downloader.
package.json    Node package metadata. ESM project, no build step.
run-mcp.cmd     Starts server.js with ROOT_DIR loaded from root-dir.txt.
mcp-here.cmd    Convenience helper: writes the current terminal directory to root-dir.txt.
root-dir.txt    The currently exposed local folder.
README.md       User-facing setup and troubleshooting guide.
```

## Current implementation

`server.js` uses:

```text
@modelcontextprotocol/sdk
zod
Node fs/promises
Node path
StdioServerTransport
```

`cli.js` uses only Node built-ins. It starts `server.js`, updates root files for `--tunnel-here`, and downloads OpenAI `tunnel-client` from official release assets on first use.

`cli.js setup` opens the OpenAI Tunnels and Runtime API keys pages, asks for `tunnel_id` and the Runtime API key, creates the tunnel-client profile, and stores the key outside this project folder under the user's private config directory.

Registered tools:

```text
list_files
read_file
search_files
stat_file
copy_file
copy_files
write_file
replace_in_file
read_binary_file_base64
write_base64_file
```

All tool paths are intended to be relative paths inside `ROOT_DIR`.

## Non-negotiable safety rules

Do not expand access beyond `ROOT_DIR` without explicit user approval.

Do not change the server to accept arbitrary absolute paths.

Do not remove path traversal protection.

Do not expose the whole `C:\` drive or full user profile by default.

Do not store OpenAI API keys, tunnel runtime keys, GitHub tokens, Discord tokens, `.env` secrets, SSH keys, or cookies in this folder.

If the CLI must persist a Runtime API key for convenience, store it only under the user's private config path (`%USERPROFILE%\.mcp-local-files\secrets.json` on Windows), never in this repository or package folder.

Do not log normal protocol messages to stdout. MCP over stdio uses stdout. Any debug output should go to stderr, and only when necessary.

Do not bundle `tunnel-client.exe` in this npm package. If tunnel support is needed, download the matching OpenAI release asset on demand, verify `SHA256SUMS.txt`, and cache the binary under the user's cache directory.

Do not add destructive file tools such as recursive delete, shell execution, arbitrary command execution, or binary overwrite without a separate explicit request from the user.

Copy-style transfer tools are allowed only within `ROOT_DIR`. Keep `copy_file` and `copy_files` non-deleting, keep `overwrite=false` by default, keep batch preflight checks before writing, and keep conservative caps.

Binary file writes are allowed only through `write_base64_file`, and must keep the existing `safePath()` guard, `overwrite=false` default, and size cap intact.

## Coding style

Keep this project boring and reliable.

Use plain JavaScript ESM. Avoid TypeScript/build tooling unless the user asks.

Keep dependencies minimal.

Prefer small helper functions over large abstractions.

Preserve Windows compatibility. Test commands in PowerShell and `cmd` style where relevant.

When registering MCP tools, provide clear descriptions, zod schemas, and appropriate annotations such as `readOnlyHint`, `destructiveHint`, and `openWorldHint`.

## Safe path handling

Every file operation must go through `safePath()` or an equivalent guard.

The guard must continue to block:

```text
absolute paths
paths escaping ROOT_DIR
.. traversal attempts
```

The server should keep returning relative paths with forward slashes where possible, so output is easier for ChatGPT/Codex to read.

## Text file handling

The server intentionally restricts reading and replacement to an allowlist of likely text file extensions.

When adding extensions, prefer common source/config/documentation formats only.

Avoid reading huge files by default. Search currently skips files above 2 MB. Keep or improve that safety behavior.

## Binary file handling

`read_binary_file_base64` and `write_base64_file` exist for images, ZIPs, PDFs, and other byte-for-byte transfers that UTF-8 text tools cannot handle safely.

`stat_file`, `copy_file`, and `copy_files` provide TransferFiles-style local file handling inside `ROOT_DIR` without deleting sources.

Keep these constraints intact:

```text
all paths go through safePath()
absolute paths stay blocked
ROOT_DIR escape stays blocked
read_binary_file_base64 must error instead of truncating over-limit files
write_base64_file must reject invalid base64
write_base64_file must keep overwrite=false by default
binary read/write size caps must remain conservative
```

Do not use the binary tools as a reason to loosen the text allowlist, expose broader folders, add shell execution, or add delete/move tools.

## Commands for agents to use

Install dependencies:

```powershell
cd %USERPROFILE%\mcp-local-files
npm install
```

Check JavaScript syntax:

```powershell
cd %USERPROFILE%\mcp-local-files
npm run check
```

First-time tunnel profile setup through the npm CLI:

```powershell
mcp-local-files setup
```

Non-interactive profile/tunnel values, while keeping the Runtime API key out of shell history:

```powershell
mcp-local-files setup --profile local-files --tunnel-id tunnel_xxx --no-open
```

Run local MCP server directly:

```powershell
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

Set current terminal folder as MCP root:

```powershell
%USERPROFILE%\mcp-local-files\mcp-here.cmd
```

Set the current folder as MCP root and start the last profile created by `mcp-local-files setup` through the npm CLI:

```powershell
mcp-local-files --tunnel-here
```

Use `--profile local-files` only when intentionally overriding the saved default profile.

Run OpenAI tunnel-client through the npm CLI auto-downloader:

```powershell
mcp-local-files tunnel run --profile local-files
```

Run tunnel client:

```powershell
cd C:\path\to\tunnel-client-folder
.\tunnel-client.exe run --profile local-files
```

Doctor check:

```powershell
cd C:\path\to\tunnel-client-folder
.\tunnel-client.exe doctor --profile local-files --explain
```

## Known Windows path issue

When creating or editing the tunnel profile, prefer forward slashes in `--mcp-command`:

```powershell
.\tunnel-client.exe init --sample sample_mcp_stdio_local --profile local-files --tunnel-id tunnel_xxx --mcp-command 'cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"'
```

Avoid raw backslash-heavy commands in YAML/profile values because they previously produced broken paths like:

```text
C:\Users\your-name\mcp-local-files\run-mcp.cmd
```

## Test checklist before considering changes done

After changing `server.js`, run:

```powershell
cd %USERPROFILE%\mcp-local-files
node --check server.js
```

After changing `cli.js` or package metadata, also run:

```powershell
cd %USERPROFILE%\mcp-local-files
npm run check
node cli.js --help
```

For setup-related changes, also run:

```powershell
node cli.js setup --help
```

Then run:

```powershell
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

The command should start and stay alive. Stop with `Ctrl+C`.

The same command is also the one tunnel-client spawns when `mcp-local-files --tunnel-here` (or `setup`) saved it into the profile. `run-mcp.cmd` uses the `endlocal & set` trick to export `ROOT_DIR` to the child node process; `server.js` falls back to `process.argv[2]` and then `root-dir.txt` if the env var is missing. Do not silently drop those two safety nets — they keep the script working both from any cwd and from the tunnel-client child context.

Then run:

```powershell
cd C:\path\to\tunnel-client-folder
.\tunnel-client.exe doctor --profile local-files --explain
```

The local MCP command should not exit immediately.

## Suggested future improvements

Useful improvements are welcome, but keep the safety model intact.

Good candidates:

```text
append_file tool
create_directory tool
file metadata/stat tool
.mcpignore support
configurable text extension allowlist
clearer error messages for bad root-dir.txt paths
read-only mode toggle
backup-before-replace option
```

Risky candidates that require explicit approval:

```text
delete_file
recursive delete
move/rename overwrite operations
shell command execution
exposing multiple roots
watching whole home directory
```

## User preference

The user wants this folder to be easy for Codex to adjust later. Prioritize maintainability, clear comments, and safe defaults over cleverness.
