# Local Files MCP

A small local MCP server that lets ChatGPT/Codex read, search, and edit a single allowed folder on this Windows machine through OpenAI Secure MCP Tunnel.

This project is intentionally simple and local-first. The server runs over stdio, and `tunnel-client.exe` forwards ChatGPT MCP requests to it. The exposed folder is controlled by `root-dir.txt`, not hardcoded in `server.js`.

## Current folder

This repository lives at:

```text
%USERPROFILE%\mcp-local-files
```

The folder currently exposed to ChatGPT/Codex is stored in:

```text
%USERPROFILE%\mcp-local-files\root-dir.txt
```

To see or change it manually:

```powershell
type %USERPROFILE%\mcp-local-files\root-dir.txt
notepad %USERPROFILE%\mcp-local-files\root-dir.txt
```

## Files

```text
server.js          MCP stdio server implementation
cli.js             npm CLI wrapper and tunnel-client downloader
package.json       Node.js dependencies and npm scripts
run-mcp.cmd        Starts the MCP server using ROOT_DIR from root-dir.txt
mcp-here.cmd       Writes the current terminal directory into root-dir.txt
root-dir.txt       Current allowed folder for Local Files MCP
AGENTS.md          Instructions for Codex/agents working on this folder
```

## Install

From PowerShell:

```powershell
cd %USERPROFILE%\mcp-local-files
npm install
```

When installed as an npm package, the CLI command is:

```powershell
mcp-local-files --help
```

## First-time tunnel setup

The CLI can guide the first tunnel profile setup:

```powershell
mcp-local-files setup
```

It will:

```text
download OpenAI tunnel-client if needed
open the OpenAI Tunnels page
open the OpenAI Runtime API keys page
ask for a tunnel_id and Runtime API key
create the default tunnel-client profile
save the Runtime API key outside this project folder
```

OpenAI setup pages:

```text
https://platform.openai.com/settings/organization/tunnels
https://platform.openai.com/settings/organization/api-keys
```

The default profile is:

```text
local-files
```

The Runtime API key is stored in the user's private config file:

```text
%USERPROFILE%\.mcp-local-files\secrets.json
```

Do not commit this file. It is intentionally outside the npm package folder.

Non-interactive values can be passed like this:

```powershell
mcp-local-files setup --profile local-files --tunnel-id tunnel_xxx --no-open
```

The Runtime API key is still requested interactively so it does not appear in shell history.

On Windows, the default MCP command saved by setup is:

```text
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

This keeps the existing `run-mcp.cmd` / `root-dir.txt` flow intact.

## Change the exposed folder quickly

Open Windows Terminal, `cd` into the folder you want ChatGPT/Codex to access, then run:

```powershell
%USERPROFILE%\mcp-local-files\mcp-here.cmd
```

Example:

```powershell
cd C:\path\to\your-project
%USERPROFILE%\mcp-local-files\mcp-here.cmd
```

After changing the folder, restart the tunnel client so the new `ROOT_DIR` is applied.

With the npm CLI, this can be done in one step:

```powershell
cd C:\path\to\your-project
mcp-local-files --tunnel-here
```

`--tunnel-here` writes the current folder to the root file, downloads OpenAI `tunnel-client` on first use if needed, verifies its SHA256 checksum, and starts the existing tunnel profile.

Use a different profile when needed:

```powershell
mcp-local-files --tunnel-here --profile local-files
```

## Start the local MCP server directly

For a local smoke test:

```powershell
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

The process should keep running. Stop it with `Ctrl+C`.

The npm CLI can also start the stdio server directly:

```powershell
mcp-local-files --root C:\path\to\folder
```

## Run through OpenAI Tunnel

The profile already created is:

```text
local-files
```

Normal run command:

```powershell
cd C:\path\to\tunnel-client-folder
.\tunnel-client.exe run --profile local-files
```

The npm CLI can download and run OpenAI `tunnel-client` automatically:

```powershell
mcp-local-files tunnel run --profile local-files
```

If `mcp-local-files setup` saved a Runtime API key for that profile, the CLI passes it to `tunnel-client` as `CONTROL_PLANE_API_KEY` only for the child process.

On first use, it downloads the matching platform zip from the official `openai/tunnel-client` GitHub release, downloads `SHA256SUMS.txt`, verifies the archive, extracts the binary into the user cache, and runs it from there.

Default cache locations:

```text
Windows: %USERPROFILE%\.cache\mcp-local-files\tunnel-client
macOS/Linux: ~/.cache/mcp-local-files/tunnel-client
```

To use an existing binary instead of auto-download:

```powershell
mcp-local-files --tunnel-client C:\path\to\tunnel-client.exe tunnel run --profile local-files
```

Useful diagnostic command:

```powershell
cd C:\path\to\tunnel-client-folder
.\tunnel-client.exe doctor --profile local-files --explain
```

If the profile must be recreated, prefer forward slashes in the MCP command to avoid Windows escaping problems:

```powershell
.\tunnel-client.exe init --sample sample_mcp_stdio_local --profile local-files --tunnel-id tunnel_xxx --mcp-command 'cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"'
```

Do not commit or paste Runtime API keys into this project. Set them only in the terminal environment when needed.

The tunnel-client binary is not bundled in this package. It is fetched from OpenAI's public release artifacts when the CLI needs it. Keep the Apache-2.0 `LICENSE` and OpenAI `NOTICE` terms in mind if redistributing downloaded artifacts yourself.

## Exposed MCP tools

The server registers these tools:

```text
list_files       List files and folders inside ROOT_DIR
read_file        Read UTF-8 text files inside ROOT_DIR
search_files     Search text files inside ROOT_DIR
write_file       Create or overwrite UTF-8 text files inside ROOT_DIR
replace_in_file  Replace exact text inside a UTF-8 text file inside ROOT_DIR
read_binary_file_base64  Read a binary file inside ROOT_DIR and return base64
write_base64_file        Decode base64 and write a binary file inside ROOT_DIR
```

### Binary file tools

Use these only for files that must be transferred as bytes, such as PNG, JPEG, WebP, GIF, ZIP, or PDF files.

`read_binary_file_base64` input:

```json
{
  "path": "images/example.png",
  "maxBytes": 10000000
}
```

It returns `path`, `size`, `base64`, `encoding: "base64"`, and a simple `mimeType` guess. If the file is larger than `maxBytes`, the server returns an error instead of truncating the data.

`write_base64_file` input:

```json
{
  "path": "images/example.png",
  "base64": "iVBORw0KGgo...",
  "overwrite": false
}
```

It creates parent folders when needed. Existing files are protected unless `overwrite` is explicitly set to `true`. Decoded binary writes are capped at 25 MB.

## Safety model

The server is scoped to one folder only. All paths passed to tools must be relative to `ROOT_DIR`.

The server blocks:

```text
absolute paths
.. path traversal outside ROOT_DIR
text reads for non-allowlisted file types
large text search over files bigger than 2 MB
binary reads above the requested maxBytes limit
binary writes above the server write-size limit
```

The directory walker skips:

```text
node_modules
.git
.venv
```

This is intentional. Do not expose `C:\`, the full user profile, or folders containing secrets unless the user explicitly requests it and understands the risk.

## Troubleshooting

If ChatGPT says connector creation failed and the tunnel log shows `file already closed`, usually the local MCP process exited immediately. Run this first:

```powershell
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

If the log says the command is not recognized, check the profile command path. Prefer this form:

```text
cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"
```

If `ROOT_DIR is required` appears, check `run-mcp.cmd` and `root-dir.txt`.

If Node cannot find packages, run:

```powershell
cd %USERPROFILE%\mcp-local-files
npm install
```

## Notes

Keep the MCP server stdio-clean. Do not print normal logs to stdout from `server.js`, because stdout is used by the MCP protocol. Use stderr only for critical startup errors.
