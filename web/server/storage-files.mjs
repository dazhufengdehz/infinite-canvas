import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class StorageError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const KEY_PATTERN = /^(image|video|audio|file|poster):(p_(.+)|assets_(.+))$/;

function assertId(id, label = "ID") {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new StorageError(400, `${label}不合法`);
    return id;
}

function normalizeMimeType(value) {
    const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : "application/octet-stream";
}

function assertProject(project) {
    if (!project || typeof project !== "object" || Array.isArray(project)) throw new StorageError(400, "项目数据不合法");
    assertId(project.id, "项目ID");
    if (typeof project.title !== "string" || typeof project.createdAt !== "string" || typeof project.updatedAt !== "string" || !Array.isArray(project.nodes) || !Array.isArray(project.connections)) {
        throw new StorageError(400, "项目数据不完整");
    }
    return project;
}

function summary(project) {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        revision: Number.isInteger(project.revision) ? project.revision : 1,
        nodeCount: project.nodes.length,
        connectionCount: project.connections.length,
    };
}

async function atomicWrite(file, data) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, data);
        await rename(temporary, file);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

async function atomicStream(file, input) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await pipeline(input, createWriteStream(temporary));
        await rename(temporary, file);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

async function readJson(file, fallback) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT" && fallback !== undefined) return fallback;
        if (error.code === "ENOENT") throw new StorageError(404, "数据不存在");
        throw error;
    }
}

export function createStorage(dataDir) {
    const root = resolve(dataDir);
    const indexFile = join(root, "projects", "index.json");
    const assetsFile = join(root, "assets", "assets.json");
    const queues = new Map();

    function serial(file, task) {
        const previous = queues.get(file) || Promise.resolve();
        const current = previous.catch(() => {}).then(task);
        queues.set(file, current);
        return current.finally(() => {
            if (queues.get(file) === current) queues.delete(file);
        });
    }

    async function readIndex() {
        const index = await readJson(indexFile, []);
        if (!Array.isArray(index)) throw new Error("项目索引格式错误");
        return index;
    }

    function updateIndex(update) {
        return serial(indexFile, async () => {
            const next = update(await readIndex());
            await atomicWrite(indexFile, JSON.stringify(next, null, 2));
            return next;
        });
    }

    const projectFile = (id) => join(root, "projects", assertId(id, "项目ID"), "project.json");

    async function parseMediaKey(key) {
        const match = typeof key === "string" ? KEY_PATTERN.exec(key) : null;
        if (!match) throw new StorageError(400, "媒体存储键不合法");
        let projectId = null;
        let mediaId = match[4];
        if (match[3] !== undefined) {
            const scoped = match[3];
            const projectIds = (await readIndex()).map((item) => item.id).filter((id) => ID_PATTERN.test(id) && scoped.startsWith(`${id}_`));
            projectId = projectIds.sort((a, b) => b.length - a.length)[0];
            if (!projectId) {
                const separator = scoped.indexOf("_");
                if (separator < 1 || separator !== scoped.lastIndexOf("_")) throw new StorageError(400, "媒体存储键所属项目不明确");
                projectId = assertId(scoped.slice(0, separator), "项目ID");
            }
            mediaId = scoped.slice(projectId.length + 1);
        }
        assertId(mediaId, "媒体ID");
        return { kind: match[1], projectId, mediaId };
    }

    function mediaPaths(parts, kind = parts.kind) {
        const base = parts.projectId ? join(root, "projects", parts.projectId) : join(root, "assets");
        const file = join(base, kind === "poster" ? "posters" : "media", parts.mediaId);
        return { ...parts, kind, file, mimeFile: `${file}.mime` };
    }

    async function readMime(mimeFile) {
        return normalizeMimeType(await readFile(mimeFile, "utf8").catch(() => ""));
    }

    async function mediaInfo(parts) {
        try {
            const info = await stat(parts.file);
            if (!info.isFile()) throw new Error("不是文件");
            return { path: parts.file, size: info.size, mimeType: await readMime(parts.mimeFile) };
        } catch (error) {
            if (error.code === "ENOENT") throw new StorageError(404, "媒体不存在");
            throw error;
        }
    }

    async function saveMedia(storageKey, input, mimeType) {
        const parts = mediaPaths(await parseMediaKey(storageKey));
        await serial(parts.file, async () => {
            await atomicStream(parts.file, input);
            await atomicWrite(parts.mimeFile, normalizeMimeType(mimeType));
        });
        return { storageKey };
    }

    async function copyParts(source, target, mimeType) {
        await serial(target.file, async () => {
            await atomicStream(target.file, createReadStream(source.file));
            await atomicWrite(target.mimeFile, normalizeMimeType(mimeType));
        });
    }

    return {
        async listProjects() {
            return readIndex();
        },

        async readProject(id) {
            return readJson(projectFile(id));
        },

        async createProject(project) {
            assertProject(project);
            const file = projectFile(project.id);
            return serial(file, async () => {
                if (await stat(file).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error))) {
                    throw new StorageError(409, "项目已存在");
                }
                const stored = { ...project, revision: 1 };
                await atomicWrite(file, JSON.stringify(stored, null, 2));
                await updateIndex((index) => [summary(stored), ...index.filter((item) => item.id !== stored.id)]);
                return stored;
            });
        },

        async saveProject(id, project, baseRevision) {
            assertId(id, "项目ID");
            assertProject(project);
            if (project.id !== id || !Number.isInteger(baseRevision)) throw new StorageError(400, "项目保存参数不合法");
            const file = projectFile(id);
            return serial(file, async () => {
                const current = await readJson(file);
                const revision = Number.isInteger(current.revision) ? current.revision : 1;
                if (baseRevision !== revision) throw new StorageError(409, "项目版本冲突");
                const stored = { ...project, id, revision: revision + 1 };
                await atomicWrite(file, JSON.stringify(stored, null, 2));
                await updateIndex((index) => index.map((item) => item.id === id ? summary(stored) : item));
                return stored;
            });
        },

        async renameProject(id, title) {
            if (typeof title !== "string" || !title.trim()) throw new StorageError(400, "项目标题不合法");
            const file = projectFile(id);
            return serial(file, async () => {
                const current = await readJson(file);
                const stored = { ...current, title: title.trim(), updatedAt: new Date().toISOString(), revision: (Number.isInteger(current.revision) ? current.revision : 1) + 1 };
                await atomicWrite(file, JSON.stringify(stored, null, 2));
                await updateIndex((index) => index.map((item) => item.id === id ? summary(stored) : item));
                return summary(stored);
            });
        },

        async deleteProject(id) {
            const file = projectFile(id);
            await serial(file, async () => {
                await readJson(file);
                await updateIndex((index) => index.filter((item) => item.id !== id));
                await rm(join(root, "projects", id), { recursive: true, force: true });
            });
        },

        async readAssets() {
            const data = await readJson(assetsFile, { assets: [] });
            return { assets: Array.isArray(data.assets) ? data.assets : [] };
        },

        async saveAssets(assets) {
            if (!Array.isArray(assets)) throw new StorageError(400, "素材数据不合法");
            await serial(assetsFile, () => atomicWrite(assetsFile, JSON.stringify({ assets }, null, 2)));
        },

        saveMedia,

        async getMedia(storageKey) {
            return mediaInfo(mediaPaths(await parseMediaKey(storageKey)));
        },

        async copyMedia(sourceStorageKey, targetStorageKey, mimeType) {
            const source = mediaPaths(await parseMediaKey(sourceStorageKey));
            const target = mediaPaths(await parseMediaKey(targetStorageKey));
            await mediaInfo(source);
            await copyParts(source, target, mimeType);
            if (source.kind !== "poster") {
                const sourcePoster = mediaPaths(source, "poster");
                const targetPoster = mediaPaths(target, "poster");
                try {
                    await stat(sourcePoster.file);
                    await copyParts(sourcePoster, targetPoster, await readMime(sourcePoster.mimeFile));
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                }
            }
            return { storageKey: targetStorageKey };
        },

        async adoptMedia(storageKey, sourceUrl, token, mimeType) {
            let url;
            try {
                url = new URL(sourceUrl);
            } catch {
                throw new StorageError(400, "远程媒体URL不合法");
            }
            if (!["http:", "https:"].includes(url.protocol) || !["/view", "/api/view"].includes(url.pathname)) {
                throw new StorageError(400, "仅允许采用/view或/api/view媒体地址");
            }
            let response;
            try {
                response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual" });
            } catch {
                throw new StorageError(502, "远程媒体下载失败");
            }
            if (!response.ok || !response.body) throw new StorageError(502, "远程媒体下载失败");
            return saveMedia(storageKey, Readable.fromWeb(response.body), mimeType);
        },

        async saveCandidatePoster(id, input) {
            const file = join(root, "cache", "candidate-posters", `${assertId(id, "候选ID")}.webp`);
            await serial(file, () => atomicStream(file, input));
            return { id };
        },

        async getCandidatePoster(id) {
            const file = join(root, "cache", "candidate-posters", `${assertId(id, "候选ID")}.webp`);
            try {
                const info = await stat(file);
                return { path: file, size: info.size, mimeType: "image/webp" };
            } catch (error) {
                if (error.code === "ENOENT") throw new StorageError(404, "候选封面不存在");
                throw error;
            }
        },
    };
}
