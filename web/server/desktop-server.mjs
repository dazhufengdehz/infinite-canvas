import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createStorage, StorageError } from "./storage-files.mjs";

export { createStorage };

const STATIC_MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
};

function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
        try {
            const url = new URL(origin);
            const localWeb = ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
            const tauri = (url.protocol === "tauri:" && url.hostname === "localhost") || (["http:", "https:"].includes(url.protocol) && url.hostname === "tauri.localhost");
            if (localWeb || tauri) {
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Vary", "Origin");
            }
        } catch {}
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function sendJson(req, res, status, data) {
    const body = JSON.stringify(data);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(req.method === "HEAD" ? undefined : body);
}

async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) throw new StorageError(413, "请求数据过大");
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
        throw new StorageError(400, "JSON请求数据不合法");
    }
}

function decodeSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        throw new StorageError(400, "请求路径不合法");
    }
}

function parseRange(header, size) {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2]) || size === 0) return false;
    let start;
    let end;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || Number.isNaN(end) || end < start || start >= size) return false;
        end = Math.min(end, size - 1);
    }
    return { start, end };
}

async function sendFile(req, res, file, supportsRange = true) {
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    const range = supportsRange ? parseRange(req.headers.range, file.size) : null;
    if (range === false) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${file.size}`);
        res.setHeader("Content-Length", "0");
        res.end();
        return;
    }
    const start = range?.start;
    const end = range?.end;
    const length = range ? end - start + 1 : file.size;
    res.statusCode = range ? 206 : 200;
    res.setHeader("Content-Length", String(length));
    if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
    if (req.method === "HEAD" || file.size === 0) {
        res.end();
        return;
    }
    await pipeline(createReadStream(file.path, range ? { start, end } : {}), res);
}

async function staticFile(root, pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        throw new StorageError(400, "请求路径不合法");
    }
    if (decoded.includes("\0")) throw new StorageError(400, "请求路径不合法");
    const file = resolve(root, `.${decoded}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) throw new StorageError(403, "禁止访问该路径");
    let selected = file;
    let info = await stat(selected).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (!info?.isFile()) {
        selected = join(root, "index.html");
        info = await stat(selected).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    }
    if (!info?.isFile()) throw new StorageError(404, "静态文件不存在");
    return { path: selected, size: info.size, mimeType: STATIC_MIME_TYPES[extname(selected).toLowerCase()] || "application/octet-stream" };
}

export function createDesktopServer(options = {}) {
    const dataDir = resolve(options.dataDir || process.env.INFINITE_CANVAS_DATA_DIR || "web/data");
    const configuredStaticDir = options.staticDir === undefined ? process.env.INFINITE_CANVAS_STATIC_DIR : options.staticDir;
    const staticDir = configuredStaticDir ? resolve(configuredStaticDir) : null;
    const storage = createStorage(dataDir);

    return http.createServer((req, res) => {
        setCors(req, res);
        handle(req, res).catch((error) => {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            const status = error instanceof StorageError ? error.status : 500;
            sendJson(req, res, status, { error: status === 500 ? "服务器内部错误" : error.message });
        });
    });

    async function handle(req, res) {
        if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
        }
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = url.pathname;

        if (pathname === "/api/health" && req.method === "GET") {
            sendJson(req, res, 200, { ok: true });
            return;
        }
        if (pathname === "/api/storage/projects") {
            if (req.method === "GET") {
                sendJson(req, res, 200, await storage.listProjects());
                return;
            }
            if (req.method === "POST") {
                const body = await readJson(req);
                sendJson(req, res, 201, await storage.createProject(body.project));
                return;
            }
        }
        const projectMatch = /^\/api\/storage\/projects\/([^/]+)$/.exec(pathname);
        if (projectMatch) {
            const id = decodeSegment(projectMatch[1]);
            if (req.method === "GET") {
                sendJson(req, res, 200, await storage.readProject(id));
                return;
            }
            if (req.method === "PUT") {
                const body = await readJson(req);
                sendJson(req, res, 200, await storage.saveProject(id, body.project, body.baseRevision));
                return;
            }
            if (req.method === "PATCH") {
                const body = await readJson(req);
                sendJson(req, res, 200, await storage.renameProject(id, body.title));
                return;
            }
            if (req.method === "DELETE") {
                await storage.deleteProject(id);
                sendJson(req, res, 200, { ok: true });
                return;
            }
        }
        if (pathname === "/api/storage/assets") {
            if (req.method === "GET") {
                sendJson(req, res, 200, await storage.readAssets());
                return;
            }
            if (req.method === "PUT") {
                const body = await readJson(req);
                await storage.saveAssets(body.assets);
                sendJson(req, res, 200, { ok: true });
                return;
            }
        }
        if (pathname === "/api/storage/media/copy" && req.method === "POST") {
            const body = await readJson(req);
            sendJson(req, res, 200, await storage.copyMedia(body.sourceStorageKey, body.targetStorageKey, body.mimeType));
            return;
        }
        if (pathname === "/api/storage/media/import" && req.method === "POST") {
            const body = await readJson(req);
            sendJson(req, res, 200, await storage.importMedia(body.targetStorageKey, body.sourcePath, body.mimeType));
            return;
        }
        if (pathname === "/api/storage/media/adopt" && req.method === "POST") {
            const body = await readJson(req);
            sendJson(req, res, 200, await storage.adoptMedia(body.targetStorageKey, body.sourceUrl, body.token, body.mimeType));
            return;
        }
        const mediaMatch = /^\/api\/storage\/media\/([^/]+)$/.exec(pathname);
        if (mediaMatch) {
            const storageKey = decodeSegment(mediaMatch[1]);
            if (req.method === "PUT") {
                sendJson(req, res, 200, await storage.saveMedia(storageKey, req, req.headers["content-type"]));
                return;
            }
            if (req.method === "GET" || req.method === "HEAD") {
                await sendFile(req, res, await storage.getMedia(storageKey));
                return;
            }
        }
        const posterMatch = /^\/api\/storage\/candidate-posters\/([^/]+)$/.exec(pathname);
        if (posterMatch) {
            const id = decodeSegment(posterMatch[1]);
            if (req.method === "PUT") {
                sendJson(req, res, 200, await storage.saveCandidatePoster(id, req));
                return;
            }
            if (req.method === "GET") {
                await sendFile(req, res, await storage.getCandidatePoster(id), false);
                return;
            }
        }
        if (pathname.startsWith("/api/")) throw new StorageError(404, "API不存在");
        if (staticDir && (req.method === "GET" || req.method === "HEAD")) {
            await sendFile(req, res, await staticFile(staticDir, pathname), false);
            return;
        }
        throw new StorageError(404, "请求不存在");
    }
}

if (process.argv[1] && resolve(process.argv[1].replace(/^\\\\\?\\/, "")) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT) || 18080;
    createDesktopServer().listen(port, "127.0.0.1", () => {
        console.log(`[DesktopServer] Storage server running at http://127.0.0.1:${port}`);
    });
}
