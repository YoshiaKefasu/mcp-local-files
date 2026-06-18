import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.env.ROOT_DIR;

if (!ROOT_DIR) {
  console.error("ROOT_DIR is required.");
  process.exit(1);
}

const ROOT = path.resolve(ROOT_DIR);

// Binary reads default to 10 MB to keep MCP responses manageable.
// 25 MB is the conservative hard ceiling for binary reads and writes.
const DEFAULT_BINARY_READ_MAX_BYTES = 10_000_000;
const MAX_BINARY_READ_BYTES = 25_000_000;
const MAX_BINARY_WRITE_BYTES = 25_000_000;
const MAX_BINARY_WRITE_BASE64_CHARS = 4 * Math.ceil(MAX_BINARY_WRITE_BYTES / 3);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".json", ".js", ".jsx", ".ts", ".tsx",
  ".css", ".html", ".yml", ".yaml", ".py", ".ps1", ".cmd",
  ".bat", ".sh", ".toml", ".ini", ".csv", ".svg", ".gitignore"
]);

function safePath(inputPath = ".") {
  const cleaned = String(inputPath || ".").replaceAll("\\", "/");

  if (path.isAbsolute(cleaned)) {
    throw new Error("Absolute paths are blocked. Use a relative path inside ROOT_DIR.");
  }

  const full = path.resolve(ROOT, cleaned);
  const rel = path.relative(ROOT, full);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes ROOT_DIR and was blocked.");
  }

  return {
    full,
    rel: rel || "."
  };
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(name);
}

function inferMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".zip":
      return "application/zip";
    case ".pdf":
      return "application/pdf";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function decodeBase64Strict(base64) {
  if (typeof base64 !== "string" || base64.length === 0) {
    throw new Error("base64 must be a non-empty string.");
  }

  const normalized = base64.replace(/\s+/g, "");

  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    throw new Error("Invalid base64 input.");
  }

  if (normalized.length > MAX_BINARY_WRITE_BASE64_CHARS) {
    throw new Error(`Decoded file is too large. Base64 input exceeds the ${MAX_BINARY_WRITE_BYTES} byte write limit.`);
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Invalid base64 input.");
  }

  const firstPadding = normalized.indexOf("=");
  if (firstPadding !== -1 && !/^=+$/.test(normalized.slice(firstPadding))) {
    throw new Error("Invalid base64 input.");
  }

  const buffer = Buffer.from(normalized, "base64");

  if (buffer.toString("base64") !== normalized) {
    throw new Error("Invalid base64 input.");
  }

  return buffer;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, maxDepth = 3, limit = 300, depth = 0, out = []) {
  if (out.length >= limit) return out;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (out.length >= limit) break;
    if (["node_modules", ".git", ".venv"].includes(entry.name)) continue;

    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      out.push({ type: "dir", path: rel });
      if (depth < maxDepth) {
        await walk(full, maxDepth, limit, depth + 1, out);
      }
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      out.push({ type: "file", path: rel, size: stat.size });
    }
  }

  return out;
}

function result(data) {
  return {
    structuredContent: data,
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

const server = new McpServer({
  name: "mcp-local-files",
  version: "0.1.0"
});

server.registerTool(
  "list_files",
  {
    title: "List files",
    description: "List files and folders inside the allowed local folder.",
    inputSchema: {
      path: z.string().default("."),
      maxDepth: z.number().int().min(0).max(8).default(2),
      limit: z.number().int().min(1).max(1000).default(300)
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  async ({ path: inputPath = ".", maxDepth = 2, limit = 300 }) => {
    const { full, rel } = safePath(inputPath);
    const stat = await fs.stat(full);

    if (!stat.isDirectory()) {
      throw new Error("Path is not a directory.");
    }

    const items = await walk(full, maxDepth, limit);
    return result({ root: ROOT, path: rel, items });
  }
);

server.registerTool(
  "read_file",
  {
    title: "Read file",
    description: "Read a UTF-8 text file inside the allowed local folder.",
    inputSchema: {
      path: z.string(),
      maxChars: z.number().int().min(1).max(200000).default(40000)
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  async ({ path: inputPath, maxChars = 40000 }) => {
    const { full, rel } = safePath(inputPath);
    const stat = await fs.stat(full);

    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }

    if (!isTextFile(full)) {
      throw new Error("This file type is not allowed as a text file.");
    }

    const text = await fs.readFile(full, "utf8");

    return result({
      path: rel,
      size: stat.size,
      truncated: text.length > maxChars,
      text: text.slice(0, maxChars)
    });
  }
);

server.registerTool(
  "read_binary_file_base64",
  {
    title: "Read binary file as base64",
    description: "Read a file inside the allowed local folder and return its bytes as base64.",
    inputSchema: {
      path: z.string(),
      maxBytes: z.number().int().min(1).max(MAX_BINARY_READ_BYTES).default(DEFAULT_BINARY_READ_MAX_BYTES)
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  async ({ path: inputPath, maxBytes = DEFAULT_BINARY_READ_MAX_BYTES }) => {
    const { full, rel } = safePath(inputPath);

    let stat;
    try {
      stat = await fs.stat(full);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error("File does not exist.");
      }
      throw error;
    }

    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }

    if (stat.size > maxBytes) {
      throw new Error(`File is too large. Size is ${stat.size} bytes, maxBytes is ${maxBytes}.`);
    }

    const buffer = await fs.readFile(full);

    return result({
      path: rel,
      size: stat.size,
      base64: buffer.toString("base64"),
      encoding: "base64",
      mimeType: inferMimeType(full)
    });
  }
);

server.registerTool(
  "search_files",
  {
    title: "Search files",
    description: "Search text files inside the allowed local folder.",
    inputSchema: {
      query: z.string(),
      path: z.string().default("."),
      maxDepth: z.number().int().min(0).max(8).default(5),
      maxFiles: z.number().int().min(1).max(1000).default(300),
      maxMatches: z.number().int().min(1).max(200).default(50)
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false
    }
  },
  async ({ query, path: inputPath = ".", maxDepth = 5, maxFiles = 300, maxMatches = 50 }) => {
    if (!query || query.length < 2) {
      throw new Error("Query must be at least 2 characters.");
    }

    const { full } = safePath(inputPath);
    const items = await walk(full, maxDepth, maxFiles);
    const q = query.toLowerCase();
    const matches = [];

    for (const item of items) {
      if (matches.length >= maxMatches) break;
      if (item.type !== "file") continue;

      const fileFull = path.resolve(ROOT, item.path);
      if (!isTextFile(fileFull)) continue;

      const stat = await fs.stat(fileFull);
      if (stat.size > 2_000_000) continue;

      const text = await fs.readFile(fileFull, "utf8");
      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          matches.push({
            path: item.path,
            line: i + 1,
            preview: lines[i].slice(0, 300)
          });
        }
      }
    }

    return result({ query, matches });
  }
);

server.registerTool(
  "write_file",
  {
    title: "Write file",
    description: "Create or overwrite a UTF-8 text file inside the allowed local folder.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
      overwrite: z.boolean().default(false)
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true
    }
  },
  async ({ path: inputPath, content, overwrite = false }) => {
    const { full, rel } = safePath(inputPath);

    if ((await exists(full)) && !overwrite) {
      throw new Error("File already exists. Set overwrite=true to replace it.");
    }

    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");

    return result({
      path: rel,
      writtenChars: content.length,
      overwritten: overwrite
    });
  }
);

server.registerTool(
  "write_base64_file",
  {
    title: "Write base64 file",
    description: "Decode base64 and write the bytes to a file inside the allowed local folder.",
    inputSchema: {
      path: z.string(),
      base64: z.string(),
      overwrite: z.boolean().default(false)
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true
    }
  },
  async ({ path: inputPath, base64, overwrite = false }) => {
    const { full, rel } = safePath(inputPath);
    const buffer = decodeBase64Strict(base64);

    if (buffer.length > MAX_BINARY_WRITE_BYTES) {
      throw new Error(`Decoded file is too large. Size is ${buffer.length} bytes, max is ${MAX_BINARY_WRITE_BYTES}.`);
    }

    const alreadyExists = await exists(full);
    if (alreadyExists && !overwrite) {
      throw new Error("File already exists. Set overwrite=true to replace it.");
    }

    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);

    return result({
      path: rel,
      writtenBytes: buffer.length,
      overwritten: alreadyExists,
      encoding: "base64"
    });
  }
);

server.registerTool(
  "replace_in_file",
  {
    title: "Replace in file",
    description: "Replace exact text inside a UTF-8 text file.",
    inputSchema: {
      path: z.string(),
      oldText: z.string(),
      newText: z.string(),
      expectedReplacements: z.number().int().min(1).max(1000).optional()
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true
    }
  },
  async ({ path: inputPath, oldText, newText, expectedReplacements }) => {
    if (!oldText) {
      throw new Error("oldText must not be empty.");
    }

    const { full, rel } = safePath(inputPath);

    if (!isTextFile(full)) {
      throw new Error("This file type is not allowed as a text file.");
    }

    const original = await fs.readFile(full, "utf8");
    const count = original.split(oldText).length - 1;

    if (count === 0) {
      throw new Error("oldText was not found.");
    }

    if (expectedReplacements !== undefined && count !== expectedReplacements) {
      throw new Error(`Replacement count mismatch. Expected ${expectedReplacements}, found ${count}.`);
    }

    const updated = original.split(oldText).join(newText);
    await fs.writeFile(full, updated, "utf8");

    return result({
      path: rel,
      replacements: count
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
