// rdsh-open-with — host half.
//
// Endpoints (all behind ctx.connection.requestRejection, same as the other
// rdsh plugins):
//
//   GET /api/rdsh-open-with/probe?path=<abs>
//     → { ok, exists, isDir, isFile, size, mime, inline } — existence and
//       previewability probe so the client can decide which menu rows to show.
//       A trailing :12 / :12-34 / #L12 line reference is retried without the
//       suffix when the literal path does not exist.
//
//   GET /api/rdsh-open-with/file?path=<abs>
//     → streams the file. Known text/html/image/pdf types render inline in a
//       new tab; anything else is an attachment. HTML is served with
//       `content-security-policy: sandbox` so arbitrary local pages cannot
//       reach the GUI's origin, and `x-content-type-options: nosniff` on all.
//
//   POST /api/rdsh-open-with/open   { target: <abs>, parent?: bool }
//     → spawns the configured opener (default xdg-open) detached. With
//       parent:true it opens dirname(target). The opener is exec'd directly,
//       never through a shell.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

export const inject = ["webServer", "connection", "sandboxPolicy"];

const API = "/api/rdsh-open-with";
const DEFAULT_MAX_INLINE = 10 * 1024 * 1024;

// ext → [content-type, inline] (inline=false renders as attachment).
const TYPES = {
  ".html": ["text/html; charset=utf-8", true],
  ".htm": ["text/html; charset=utf-8", true],
  ".xhtml": ["application/xhtml+xml", true],
  ".css": ["text/css; charset=utf-8", true],
  ".js": ["text/javascript; charset=utf-8", true],
  ".mjs": ["text/javascript; charset=utf-8", true],
  ".cjs": ["text/javascript; charset=utf-8", true],
  ".json": ["application/json; charset=utf-8", true],
  ".svg": ["image/svg+xml", true],
  ".png": ["image/png", true],
  ".jpg": ["image/jpeg", true],
  ".jpeg": ["image/jpeg", true],
  ".gif": ["image/gif", true],
  ".webp": ["image/webp", true],
  ".avif": ["image/avif", true],
  ".bmp": ["image/bmp", true],
  ".ico": ["image/x-icon", true],
  ".pdf": ["application/pdf", true],
  ".txt": ["text/plain; charset=utf-8", true],
  ".text": ["text/plain; charset=utf-8", true],
  ".log": ["text/plain; charset=utf-8", true],
  ".md": ["text/plain; charset=utf-8", true],
  ".markdown": ["text/plain; charset=utf-8", true],
  ".rs": ["text/plain; charset=utf-8", true],
  ".py": ["text/plain; charset=utf-8", true],
  ".pyw": ["text/plain; charset=utf-8", true],
  ".ts": ["text/plain; charset=utf-8", true],
  ".tsx": ["text/plain; charset=utf-8", true],
  ".jsx": ["text/plain; charset=utf-8", true],
  ".c": ["text/plain; charset=utf-8", true],
  ".h": ["text/plain; charset=utf-8", true],
  ".cc": ["text/plain; charset=utf-8", true],
  ".cpp": ["text/plain; charset=utf-8", true],
  ".hpp": ["text/plain; charset=utf-8", true],
  ".java": ["text/plain; charset=utf-8", true],
  ".kt": ["text/plain; charset=utf-8", true],
  ".go": ["text/plain; charset=utf-8", true],
  ".rb": ["text/plain; charset=utf-8", true],
  ".php": ["text/plain; charset=utf-8", true],
  ".sh": ["text/plain; charset=utf-8", true],
  ".bash": ["text/plain; charset=utf-8", true],
  ".zsh": ["text/plain; charset=utf-8", true],
  ".fish": ["text/plain; charset=utf-8", true],
  ".sql": ["text/plain; charset=utf-8", true],
  ".xml": ["text/plain; charset=utf-8", true],
  ".csv": ["text/plain; charset=utf-8", true],
  ".tsv": ["text/plain; charset=utf-8", true],
  ".yaml": ["text/plain; charset=utf-8", true],
  ".yml": ["text/plain; charset=utf-8", true],
  ".toml": ["text/plain; charset=utf-8", true],
  ".ini": ["text/plain; charset=utf-8", true],
  ".cfg": ["text/plain; charset=utf-8", true],
  ".conf": ["text/plain; charset=utf-8", true],
  ".env": ["text/plain; charset=utf-8", true],
  ".lock": ["text/plain; charset=utf-8", true],
  ".diff": ["text/plain; charset=utf-8", true],
  ".patch": ["text/plain; charset=utf-8", true],
};

const LINE_SUFFIX_RE = /:(?:\d+)(?:-\d+)?$/;
const HASH_LINE_RE = /#L\d+$/;

function typeFor(path) {
  const entry = TYPES[extname(path).toLowerCase()];
  return entry ? { mime: entry[0], inline: entry[1] } : { mime: "application/octet-stream", inline: false };
}

/**
 * Absolute paths are used as-is (`~` expands to the server user's home).
 * Relative paths resolve against the workspace root and must stay inside it.
 * Null when unusable.
 *
 * `workspaceRoot` here is the Session's workspace root when the client supplied
 * one (see {@link requestRoot}), otherwise the configured/server default.
 */
function resolveTarget(raw, workspaceRoot) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  // 制御文字（NUL 含む）は拒否。空白はファイル名に合法なので許す。
  if (!value || !/^[^\u0000-\u001f]*$/.test(value)) return null;
  if (value === "~") value = homedir();
  else if (value.startsWith("~/")) value = join(homedir(), value.slice(2));
  if (!isAbsolute(value)) {
    if (typeof workspaceRoot !== "string" || !workspaceRoot) return null;
    // 相対パスは workspace root を出ない範囲で解決する（絶対パスは制限しない）。
    if (/(^|\/)\.\.(\/|$)/.test(value)) return null;
    value = join(workspaceRoot, value);
  }
  return resolve(value);
}

/**
 * Root for relative resolution: the Session's workspace root, sent by the client
 * as `root`. This plugin is not session-scoped, so the host's own default
 * (`sandboxPolicy.workspaceRoot`, the server process directory) is wrong as soon
 * as the Session opened another workspace. Only an absolute value is accepted;
 * `..` is still rejected inside {@link resolveTarget}.
 */
function requestRoot(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  return isAbsolute(value) ? resolve(value) : fallback;
}

/** stat(2) the literal path first; compiler-style line references are then retried stripped. */
async function statFlexible(resolved) {
  try {
    return { path: resolved, info: await stat(resolved) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const stripped = resolved.replace(LINE_SUFFIX_RE, "").replace(HASH_LINE_RE, "");
  if (stripped === resolved) return null;
  try {
    return { path: stripped, info: await stat(stripped) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function authorize(ctx, req, res) {
  const status = typeof ctx.connection?.requestRejection === "function"
    ? ctx.connection.requestRejection(req) : 503;
  if (status === undefined) return true;
  json(res, status, { ok: false, error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "authentication-unavailable" });
  return false;
}

async function readBody(req, limit = 8192) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function openWith(opener, target) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(opener, [target], { detached: true, stdio: "ignore" });
    } catch {
      resolvePromise({ ok: false, message: "could not start opener" });
      return;
    }
    child.on("error", () => resolvePromise({ ok: false, message: "could not start opener" }));
    child.on("spawn", () => {
      child.unref();
      resolvePromise({ ok: true });
    });
  });
}

export function apply(ctx, config) {
  const opener = typeof config?.opener === "string" && config.opener.trim()
    ? config.opener.trim() : "xdg-open";
  const workspaceRoot = typeof config?.workspaceRoot === "string" && isAbsolute(config.workspaceRoot)
    ? resolve(config.workspaceRoot)
    : (typeof ctx.sandboxPolicy?.workspaceRoot === "string" ? ctx.sandboxPolicy.workspaceRoot : undefined);
  const maxInline = Number.isSafeInteger(config?.maxInlineBytes) && config.maxInlineBytes > 0
    ? config.maxInlineBytes : DEFAULT_MAX_INLINE;
  return ctx.effect(() => {
    if (!ctx.webServer) return;

    const offProbe = ctx.webServer.register({
      kind: "exact",
      path: API + "/probe",
      handler: async (req, res) => {
        if (!authorize(ctx, req, res)) return;
        if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "method-not-allowed" });
        try {
          const url = new URL(req.url, "http://localhost");
          const target = resolveTarget(
            url.searchParams.get("path"),
            requestRoot(url.searchParams.get("root"), workspaceRoot),
          );
          if (!target) return json(res, 400, { ok: false, error: "invalid-path" });
          const hit = await statFlexible(target);
          if (!hit) return json(res, 200, { ok: true, exists: false });
          const type = typeFor(hit.path);
          json(res, 200, {
            ok: true,
            exists: true,
            path: hit.path,
            isDir: hit.info.isDirectory(),
            isFile: hit.info.isFile(),
            size: hit.info.size,
            mime: type.mime,
            inline: type.inline && hit.info.isFile() && hit.info.size <= maxInline,
          });
        } catch (error) {
          json(res, 500, { ok: false, error: "probe-failed" });
        }
      },
    });

    const offFile = ctx.webServer.register({
      kind: "exact",
      path: API + "/file",
      handler: async (req, res) => {
        if (!authorize(ctx, req, res)) return;
        if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { ok: false, error: "method-not-allowed" });
        try {
          const url = new URL(req.url, "http://localhost");
          const target = resolveTarget(url.searchParams.get("path"), workspaceRoot);
          if (!target) return json(res, 400, { ok: false, error: "invalid-path" });
          const hit = await statFlexible(target);
          if (!hit) return json(res, 404, { ok: false, error: "not-found" });
          if (!hit.info.isFile()) return json(res, 400, { ok: false, error: "not-a-file" });
          const type = typeFor(hit.path);
          const inline = type.inline && hit.info.size <= maxInline;
          const headers = {
            "content-type": type.mime,
            "content-length": hit.info.size,
            "content-disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(basename(hit.path)),
            "x-content-type-options": "nosniff",
            "cache-control": "no-store",
          };
          // Sandboxed so a hostile local page cannot touch the GUI origin.
          if (type.mime.startsWith("text/html")) headers["content-security-policy"] = "sandbox";
          res.writeHead(200, headers);
          if (req.method === "HEAD") return void res.end();
          createReadStream(hit.path).on("error", () => res.destroy()).pipe(res);
        } catch (error) {
          const status = error.code === "ENOENT" ? 404 : error.code === "EACCES" || error.code === "EPERM" ? 403 : 500;
          if (!res.headersSent) json(res, status, { ok: false, error: "file-unavailable" });
          else res.destroy();
        }
      },
    });

    const offOpen = ctx.webServer.register({
      kind: "exact",
      path: API + "/open",
      handler: async (req, res) => {
        if (!authorize(ctx, req, res)) return;
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
        let input;
        try {
          input = await readBody(req);
        } catch {
          return json(res, 400, { ok: false, error: "invalid-body" });
        }
        const target = resolveTarget(input?.target, workspaceRoot);
        if (!target) return json(res, 400, { ok: false, error: "invalid-path" });
        try {
          const hit = await statFlexible(target);
          // Fall back to the literal path: xdg-open may still do something
          // useful for paths that live on another host/container.
          const finalPath = hit ? hit.path : target;
          const destination = input?.parent === true ? dirname(finalPath) : finalPath;
          json(res, 200, await openWith(opener, destination));
        } catch (error) {
          json(res, 500, { ok: false, error: "open-failed" });
        }
      },
    });

    return () => {
      for (const off of [offProbe, offFile, offOpen]) {
        try { if (typeof off === "function") off(); } catch {}
      }
    };
  });
}
