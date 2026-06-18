#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(PACKAGE_DIR, "server.js");
const PACKAGE_ROOT_FILE = path.join(PACKAGE_DIR, "root-dir.txt");
const LEGACY_ROOT_FILE = path.join(os.homedir(), "mcp-local-files", "root-dir.txt");
const CONFIG_DIR = path.join(os.homedir(), ".mcp-local-files");
const CONFIG_ROOT_FILE = path.join(CONFIG_DIR, "root-dir.txt");
const CONFIG_SECRETS_FILE = path.join(CONFIG_DIR, "secrets.json");
const CACHE_DIR = path.join(os.homedir(), ".cache", "mcp-local-files", "tunnel-client");
const TUNNEL_REPO = "https://api.github.com/repos/openai/tunnel-client/releases/latest";
const DEFAULT_PROFILE = "local-files";
const TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const RUNTIME_KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";

function defaultMcpCommand() {
  if (process.platform === "win32") {
    return 'cmd /d /s /c "%USERPROFILE%/mcp-local-files/run-mcp.cmd"';
  }

  return "mcp-local-files";
}

function usage() {
  return `Local Files MCP

Usage:
  mcp-local-files                         Start the MCP stdio server
  mcp-local-files --root <folder>         Start the MCP stdio server for a folder
  mcp-local-files --tunnel-here           Set current folder as ROOT_DIR, then run tunnel-client
  mcp-local-files --tunnel-here --profile <name>
  mcp-local-files setup                   Create the default tunnel-client profile
  mcp-local-files tunnel <args...>        Run OpenAI tunnel-client, downloading it if needed

Options:
  --profile <name>        Tunnel profile name for setup/--tunnel-here (default: last setup profile, then ${DEFAULT_PROFILE})
  --tunnel-client <path>  Use an existing tunnel-client binary
  --tunnel-id <id>        Tunnel id for setup
  --mcp-command <command> MCP command for setup (default: ${defaultMcpCommand()})
  --no-open               Do not open OpenAI setup pages during setup
  --help                  Show this help
`;
}

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    command: "server",
    profile: DEFAULT_PROFILE,
    profileSpecified: false,
    tunnelClient: process.env.TUNNEL_CLIENT_PATH || "",
    root: "",
    tunnelId: "",
    mcpCommand: defaultMcpCommand(),
    openSetupPages: true,
    passthrough: []
  };

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--help" || arg === "-h") {
      parsed.command = "help";
      break;
    } else if (arg === "--tunnel-here") {
      parsed.command = "tunnel-here";
    } else if (arg === "setup") {
      parsed.command = "setup";
    } else if (arg === "tunnel") {
      parsed.command = "tunnel";
      parsed.passthrough = args;
      break;
    } else if (arg === "--profile") {
      parsed.profile = requireValue(arg, args.shift());
      parsed.profileSpecified = true;
    } else if (arg === "--tunnel-client") {
      parsed.tunnelClient = requireValue(arg, args.shift());
    } else if (arg === "--root") {
      parsed.root = requireValue(arg, args.shift());
    } else if (arg === "--tunnel-id") {
      parsed.tunnelId = requireValue(arg, args.shift());
    } else if (arg === "--mcp-command") {
      parsed.mcpCommand = requireValue(arg, args.shift());
    } else if (arg === "--no-open") {
      parsed.openSetupPages = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(name, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readRootFile() {
  const candidates = [process.env.MCP_LOCAL_FILES_ROOT_FILE, CONFIG_ROOT_FILE, PACKAGE_ROOT_FILE, LEGACY_ROOT_FILE].filter(Boolean);

  for (const filePath of candidates) {
    if (await pathExists(filePath)) {
      const value = (await fs.readFile(filePath, "utf8")).trim();
      if (value) return value;
    }
  }

  return process.cwd();
}

async function writeRootFiles(rootDir) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_ROOT_FILE, `${rootDir}\n`, "utf8");

  await writeRootFileBestEffort(PACKAGE_ROOT_FILE, rootDir);
  await writeRootFileBestEffort(LEGACY_ROOT_FILE, rootDir);
}

async function writeRootFileBestEffort(filePath, rootDir) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${rootDir}\n`, "utf8");
  } catch (error) {
    // Global npm installs can be read-only. CONFIG_ROOT_FILE is the canonical CLI root file.
    console.error(`Warning: could not write ${filePath}: ${error?.message || error}`);
  }
}

async function readSecrets() {
  if (!await pathExists(CONFIG_SECRETS_FILE)) {
    return { defaultProfile: "", profiles: {} };
  }

  let parsed;

  try {
    const text = await fs.readFile(CONFIG_SECRETS_FILE, "utf8");
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not read ${CONFIG_SECRETS_FILE}: ${error?.message || error}. Delete it and run setup again if it is corrupted.`);
  }

  const profiles = parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.profiles && typeof parsed.profiles === "object"
    ? parsed.profiles
    : {};

  return {
    defaultProfile: typeof parsed?.defaultProfile === "string" ? parsed.defaultProfile : "",
    profiles
  };
}

async function writeSecrets(secrets) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_SECRETS_FILE, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });

  if (process.platform !== "win32") {
    await fs.chmod(CONFIG_SECRETS_FILE, 0o600);
  }
}

async function saveProfileSecret(profile, tunnelId, apiKey) {
  const secrets = await readSecrets();
  secrets.defaultProfile = profile;
  secrets.profiles[profile] = {
    tunnelId,
    controlPlaneApiKey: apiKey
  };
  await writeSecrets(secrets);
}

async function resolveProfile(requestedProfile, profileSpecified = false) {
  if (profileSpecified) return requestedProfile;

  const secrets = await readSecrets();
  if (secrets.defaultProfile) return secrets.defaultProfile;

  const savedProfiles = Object.keys(secrets.profiles || {});
  if (savedProfiles.length === 1) return savedProfiles[0];

  return requestedProfile || DEFAULT_PROFILE;
}

async function loadProfileEnv(profile) {
  if (!profile) return {};
  const secrets = await readSecrets();
  const saved = secrets.profiles[profile];

  if (!saved?.controlPlaneApiKey) {
    return {};
  }

  return {
    CONTROL_PLANE_API_KEY: saved.controlPlaneApiKey,
    ...(saved.tunnelId ? { CONTROL_PLANE_TUNNEL_ID: saved.tunnelId } : {})
  };
}

function inferProfile(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--profile") {
      return args[index + 1] || "";
    }

    if (arg.startsWith("--profile=")) {
      return arg.slice("--profile=".length);
    }
  }

  return "";
}

async function startServer(rootDir) {
  const root = path.resolve(rootDir || await readRootFile());
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, ROOT_DIR: root },
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function platformAssetName(tagName) {
  const platformMap = {
    win32: "windows",
    darwin: "darwin",
    linux: "linux"
  };
  const archMap = {
    x64: "amd64",
    arm64: "arm64"
  };

  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];

  if (!platform || !arch) {
    throw new Error(`Unsupported platform for tunnel-client auto-download: ${process.platform}/${process.arch}`);
  }

  return `tunnel-client-${tagName}-${platform}-${arch}.zip`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "mcp-local-files" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { headers: { "User-Agent": "mcp-local-files" } });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(response.body, createWriteStream(destination));
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");

  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }

  return hash.digest("hex");
}

function findAsset(release, name) {
  const asset = release.assets?.find((item) => item.name === name);
  if (!asset?.browser_download_url) {
    throw new Error(`Could not find tunnel-client release asset: ${name}`);
  }
  return asset;
}

async function verifyChecksum(zipPath, assetName, checksumsText) {
  const expectedParts = checksumsText
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === assetName);
  const expected = expectedParts?.[0]?.match(/^[a-fA-F0-9]{64}$/)?.[0]?.toLowerCase();

  if (!expected) {
    throw new Error(`Could not find SHA256 entry for ${assetName}.`);
  }

  const actual = await sha256(zipPath);
  if (actual !== expected) {
    throw new Error(`SHA256 mismatch for ${assetName}. Expected ${expected}, got ${actual}.`);
  }
}

async function extractZip(zipPath, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  if (process.platform === "win32") {
    await runProcess("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive", "-LiteralPath", zipPath, "-DestinationPath", destination, "-Force"]);
  } else {
    await runProcess("unzip", ["-q", zipPath, "-d", destination]);
  }
}

async function findTunnelBinary(directory) {
  const target = process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isFile() && entry.name === target) {
      return full;
    }

    if (entry.isDirectory()) {
      try {
        return await findTunnelBinary(full);
      } catch (error) {
        if (!String(error?.message || "").includes("Extracted archive did not contain")) {
          throw error;
        }
      }
    }
  }

  throw new Error(`Extracted archive did not contain ${target}.`);
}

async function ensureTunnelClient(explicitPath = "") {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!await pathExists(resolved)) {
      throw new Error(`tunnel-client was not found: ${resolved}`);
    }
    return resolved;
  }

  const release = await fetchJson(TUNNEL_REPO);
  const tagName = release.tag_name;

  if (typeof tagName !== "string" || !/^[A-Za-z0-9._+-]+$/.test(tagName)) {
    throw new Error(`Refusing unexpected tunnel-client release tag: ${tagName}`);
  }

  const assetName = platformAssetName(tagName);
  const installDir = path.join(CACHE_DIR, tagName, `${process.platform}-${process.arch}`);
  const binaryPath = path.join(installDir, process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");

  if (await pathExists(binaryPath)) {
    return binaryPath;
  }

  const asset = findAsset(release, assetName);
  const checksumAsset = findAsset(release, "SHA256SUMS.txt");
  const zipPath = path.join(CACHE_DIR, tagName, assetName);
  const checksumsPath = path.join(CACHE_DIR, tagName, "SHA256SUMS.txt");

  console.error(`Downloading OpenAI tunnel-client ${tagName} (${process.platform}/${process.arch})...`);
  await downloadFile(asset.browser_download_url, zipPath);
  await downloadFile(checksumAsset.browser_download_url, checksumsPath);

  const checksumsText = await fs.readFile(checksumsPath, "utf8");
  await verifyChecksum(zipPath, assetName, checksumsText);
  await extractZip(zipPath, installDir);

  const extractedBinary = await findTunnelBinary(installDir);
  if (extractedBinary !== binaryPath) {
    await fs.rename(extractedBinary, binaryPath);
  }

  if (process.platform !== "win32") {
    await fs.chmod(binaryPath, 0o755);
  }

  console.error(`Installed tunnel-client to ${binaryPath}`);
  return binaryPath;
}

async function runProcess(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.stdio || "inherit", env: options.env || process.env });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}.`));
      } else if (code) {
        reject(new Error(`${command} exited with code ${code}.`));
      } else {
        resolve();
      }
    });
  });
}

async function runTunnel(args, tunnelClientPath, profile = "") {
  const binary = await ensureTunnelClient(tunnelClientPath);
  const profileEnv = await loadProfileEnv(profile || inferProfile(args));
  const child = spawn(binary, args, { stdio: "inherit", env: { ...process.env, ...profileEnv } });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

async function openUrl(url) {
  const commands = {
    win32: ["cmd.exe", ["/d", "/s", "/c", "start", "", url]],
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]]
  };
  const command = commands[process.platform];

  if (!command) {
    console.error(`Open this URL in your browser: ${url}`);
    return;
  }

  try {
    // Windows `start` treats the first quoted argument as a title, so pass an empty title.
    await runProcess(command[0], command[1], { stdio: "ignore" });
  } catch {
    console.error(`Open this URL in your browser: ${url}`);
  }
}

async function promptLine(question, defaultValue = "") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  try {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = await rl.question(`${question}${suffix}: `);
    return answer.trim() || defaultValue;
  } finally {
    rl.close();
  }
}

async function promptSecret(question) {
  if (!process.stdin.isTTY) {
    return promptLine(question);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";

    process.stderr.write(`${question}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      process.stderr.write("\n");
    };

    const onData = (chunk) => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }

      if (chunk === "\r" || chunk === "\n") {
        cleanup();
        resolve(value.trim());
        return;
      }

      if (chunk === "\u007f" || chunk === "\b") {
        value = value.slice(0, -1);
        return;
      }

      value += chunk;
    };

    stdin.on("data", onData);
  });
}

function validateTunnelId(tunnelId) {
  if (!/^tunnel_[A-Za-z0-9]+$/.test(tunnelId)) {
    throw new Error("Tunnel id should look like tunnel_xxx.");
  }
}

function validateApiKey(apiKey) {
  if (!apiKey || apiKey.length < 20) {
    throw new Error("Runtime API key is too short or empty.");
  }
}

async function setupProfile(parsed) {
  const binary = await ensureTunnelClient(parsed.tunnelClient);

  console.error("OpenAI setup pages:");
  console.error(`- Tunnels: ${TUNNELS_URL}`);
  console.error(`- Runtime API keys: ${RUNTIME_KEYS_URL}`);

  if (parsed.openSetupPages) {
    await openUrl(TUNNELS_URL);
    await openUrl(RUNTIME_KEYS_URL);
  }

  const profile = await promptLine("Profile name", parsed.profile);
  const tunnelId = await promptLine("Tunnel ID", parsed.tunnelId);
  validateTunnelId(tunnelId);

  const apiKey = await promptSecret("Runtime API key (hidden)");
  validateApiKey(apiKey);

  const mcpCommand = await promptLine("MCP command", parsed.mcpCommand);
  await saveProfileSecret(profile, tunnelId, apiKey);

  await runProcess(binary, [
    "init",
    "--sample",
    "sample_mcp_stdio_local",
    "--profile",
    profile,
    "--tunnel-id",
    tunnelId,
    "--mcp-command",
    mcpCommand
  ], {
    env: {
      ...process.env,
      CONTROL_PLANE_API_KEY: apiKey,
      CONTROL_PLANE_TUNNEL_ID: tunnelId
    }
  });

  console.error(`Saved tunnel credentials for profile '${profile}' to ${CONFIG_SECRETS_FILE}`);
  console.error(`Default tunnel profile is now '${profile}'.`);
  console.error("Next: mcp-local-files --tunnel-here");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === "help") {
    console.log(usage());
    return;
  }

  if (parsed.command === "server") {
    await startServer(parsed.root);
    return;
  }

  if (parsed.command === "setup") {
    await setupProfile(parsed);
    return;
  }

  if (parsed.command === "tunnel") {
    await runTunnel(parsed.passthrough, parsed.tunnelClient);
    return;
  }

  if (parsed.command === "tunnel-here") {
    const root = process.cwd();
    const profile = await resolveProfile(parsed.profile, parsed.profileSpecified);
    await writeRootFiles(root);
    console.error(`Local Files MCP ROOT_DIR is now: ${root}`);
    console.error(`Using tunnel profile: ${profile}`);
    await runTunnel(["run", "--profile", profile], parsed.tunnelClient, profile);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
