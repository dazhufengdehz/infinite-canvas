import { constants, createReadStream, createWriteStream, readFileSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
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
const SCHEMA_VERSION = 2;

function assertId(id, label = "ID") {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new StorageError(400, `${label}不合法`);
    return id;
}

function assertSchema(data, label) {
    if (data && data.schemaVersion !== SCHEMA_VERSION) throw new StorageError(422, `${label}数据格式版本不兼容，请从导出备份恢复或重建项目`);
    return data;
}

function normalizeMimeType(value) {
    const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : "application/octet-stream";
}

function assertProject(project) {
    if (!project || typeof project !== "object" || Array.isArray(project)) throw new StorageError(400, "项目数据不合法");
    assertId(project.id, "项目ID");
    assertSchema(project, "项目");
    if (typeof project.title !== "string" || typeof project.createdAt !== "string" || typeof project.updatedAt !== "string") throw new StorageError(400, "项目数据不完整");
    return project;
}

function assertCanvas(canvas, projectId) {
    if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) throw new StorageError(400, "画布数据不合法");
    assertId(canvas.id, "画布ID");
    assertSchema(canvas, "画布");
    if (canvas.projectId !== projectId || typeof canvas.title !== "string" || typeof canvas.createdAt !== "string" || typeof canvas.updatedAt !== "string" || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.connections)) {
        throw new StorageError(400, "画布数据不完整");
    }
    return canvas;
}

function projectSummary(project, previous, canvases) {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        revision: Number.isInteger(project.revision) ? project.revision : 1,
        canvasCount: canvases.length,
        nodeCount: canvases.reduce((total, canvas) => total + canvas.nodeCount, 0),
        connectionCount: canvases.reduce((total, canvas) => total + canvas.connectionCount, 0),
        assetCount: previous?.assetCount || 0,
    };
}

function canvasSummary(canvas) {
    return {
        id: canvas.id,
        projectId: canvas.projectId,
        title: canvas.title,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
        revision: Number.isInteger(canvas.revision) ? canvas.revision : 1,
        nodeCount: canvas.nodes.length,
        connectionCount: canvas.connections.length,
    };
}

const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);
const RETRY_DELAYS = [50, 150, 400];

async function withRetry(task) {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
            return await task();
        } catch (error) {
            lastError = error;
            if (!RETRYABLE_CODES.has(error?.code) || attempt === RETRY_DELAYS.length) break;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, RETRY_DELAYS[attempt]));
        }
    }
    throw lastError;
}

async function atomicWrite(file, data) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, data);
        await withRetry(() => rename(temporary, file));
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
        await withRetry(() => rename(temporary, file));
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

async function writeTemporary(file, input) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await pipeline(input, createWriteStream(temporary));
        return temporary;
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

async function pathExists(path) {
    return stat(path).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
}

async function folderStats(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = await folderStats(path);
            files += nested.files;
            bytes += nested.bytes;
        } else if (entry.isFile()) {
            const info = await stat(path);
            files += 1;
            bytes += info.size;
        }
    }
    return { files, bytes };
}

function safeFolderName(value, fallback) {
    const normalized = String(value || "").replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+$/, "").trim().slice(0, 60);
    return normalized || fallback;
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
    const projectPathsFile = join(root, "project-paths.json");
    const migrationsFile = join(root, "migrations.json");
    let queueTail = Promise.resolve();
    let projectPaths = {};
    try {
        const parsed = JSON.parse(readFileSync(projectPathsFile, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("项目路径映射格式错误");
        projectPaths = parsed;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    // 所有写操作共用一个串行队列，避免不同文件的读-改-写交错覆盖。
    function enqueue(task) {
        const current = queueTail.catch(() => {}).then(task);
        queueTail = current.catch(() => {});
        return current;
    }

    function drain() {
        return queueTail;
    }

    async function readIndex() {
        const index = await readJson(indexFile, []);
        if (!Array.isArray(index)) throw new Error("项目索引格式错误");
        return index;
    }

    async function updateIndexDirect(update) {
        const next = update(await readIndex());
        await atomicWrite(indexFile, JSON.stringify(next, null, 2));
        return next;
    }

    function updateIndex(update) {
        return enqueue(() => updateIndexDirect(update));
    }

    function projectDir(id) {
        const registered = projectPaths[assertId(id, "项目ID")];
        if (typeof registered !== "string" || !registered) throw new StorageError(409, "项目位置未登记，请先迁移到指定文件夹");
        return resolve(registered);
    }

    function legacyProjectDir(id) {
        return join(root, "projects", assertId(id, "项目ID"));
    }

    async function updateProjectPathsDirect(update) {
        const next = update({ ...projectPaths });
        projectPaths = next;
        await atomicWrite(projectPathsFile, JSON.stringify(next, null, 2));
        return next;
    }

    function updateProjectPaths(update) {
        return enqueue(() => updateProjectPathsDirect(update));
    }

    async function readMigrations() {
        const data = await readJson(migrationsFile, { migrations: [] });
        return Array.isArray(data.migrations) ? data.migrations : [];
    }

    async function updateMigrationsDirect(update) {
        const next = update({ migrations: await readMigrations() });
        const normalized = Array.isArray(next.migrations) ? next : { migrations: [] };
        await atomicWrite(migrationsFile, JSON.stringify(normalized, null, 2));
        return normalized.migrations;
    }

    const projectFile = (id) => join(projectDir(id), "project.json");
    const canvasIndexFile = (id) => join(projectDir(id), "canvases", "index.json");
    const canvasFile = (projectId, canvasId) => join(projectDir(projectId), "canvases", `${assertId(canvasId, "画布ID")}.json`);
    const projectAssetsFile = (id) => join(projectDir(id), "assets.json");

    async function readProjectFile(id) {
        const dir = projectDir(id);
        try {
            return assertSchema(await readJson(projectFile(id)), "项目");
        } catch (error) {
            if (error instanceof StorageError && error.status === 404 && projectPaths[id]) {
                const info = await stat(dir).catch(() => null);
                if (!info?.isDirectory()) throw new StorageError(404, `项目存放目录不存在或已被移动：${dir}`);
                throw new StorageError(404, `项目存放目录中缺少 project.json：${dir}`);
            }
            throw error;
        }
    }

    async function readCanvasIndex(projectId) {
        const index = await readJson(canvasIndexFile(projectId), []);
        if (!Array.isArray(index)) throw new Error("画布索引格式错误");
        return index;
    }

    function updateCanvasIndex(projectId, update) {
        const file = canvasIndexFile(projectId);
        return enqueue(async () => {
            const next = update(await readCanvasIndex(projectId));
            await atomicWrite(file, JSON.stringify(next, null, 2));
            return next;
        });
    }

    // 读取和写回必须在同一个队列任务内，否则会被其他写入覆盖。
    function touchProject(projectId, canvases) {
        return enqueue(async () => {
            const file = projectFile(projectId);
            const current = assertSchema(await readJson(file), "项目");
            const stored = { ...current, updatedAt: new Date().toISOString() };
            await atomicWrite(file, JSON.stringify(stored, null, 2));
            await updateIndexDirect((index) => index.map((item) => item.id === projectId ? projectSummary(stored, item, canvases) : item));
            return stored;
        });
    }

    function updateProjectAssetsSummary(projectId, assets) {
        return enqueue(async () => {
            const file = projectFile(projectId);
            const current = assertSchema(await readJson(file), "项目");
            const stored = { ...current, updatedAt: new Date().toISOString() };
            await atomicWrite(file, JSON.stringify(stored, null, 2));
            const canvases = await readCanvasIndex(projectId);
            await updateIndexDirect((index) => index.map((item) => item.id === projectId ? projectSummary(stored, { assetCount: assets.length }, canvases) : item));
        });
    }

    async function parseMediaKey(key) {
        const match = typeof key === "string" ? KEY_PATTERN.exec(key) : null;
        if (!match) throw new StorageError(400, "媒体存储键不合法");
        let projectId = null;
        let mediaId = match[4];
        if (match[3] !== undefined) {
            const scoped = match[3];
            const knownIds = [...new Set([...(await readIndex()).map((item) => item.id), ...Object.keys(projectPaths)])];
            const projectIds = knownIds.filter((id) => ID_PATTERN.test(id) && scoped.startsWith(`${id}_`));
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
        const base = parts.projectId ? projectDir(parts.projectId) : join(root, "assets");
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
        // 大文件传输在队列外完成，只把原子替换放进全局队列，避免阻塞元数据落盘。
        const temporary = await writeTemporary(parts.file, input);
        try {
            await enqueue(async () => {
                await withRetry(() => rename(temporary, parts.file));
                await atomicWrite(parts.mimeFile, normalizeMimeType(mimeType));
            });
        } catch (error) {
            await unlink(temporary).catch(() => {});
            throw error;
        }
        return { storageKey };
    }

    async function copyParts(source, target, mimeType) {
        const temporary = await writeTemporary(target.file, createReadStream(source.file));
        try {
            await enqueue(async () => {
                await withRetry(() => rename(temporary, target.file));
                await atomicWrite(target.mimeFile, normalizeMimeType(mimeType));
            });
        } catch (error) {
            await unlink(temporary).catch(() => {});
            throw error;
        }
    }

    return {
        async listProjects() {
            const index = await readIndex();
            return Promise.all(index.map(async (item) => {
                const registered = projectPaths[item.id];
                if (typeof registered === "string" && registered) return { ...item, storagePath: resolve(registered) };
                const legacyPath = legacyProjectDir(item.id);
                const legacyExists = await stat(join(legacyPath, "project.json")).then((info) => info.isFile(), () => false);
                return { ...item, migrateRequired: true, legacyPath: legacyExists ? legacyPath : null };
            }));
        },

        async readProject(id) {
            return readProjectFile(id);
        },

        async checkProjectFolder(storagePath) {
            if (typeof storagePath !== "string" || !isAbsolute(storagePath)) throw new StorageError(400, "项目存放路径必须是绝对路径");
            const dir = resolve(storagePath);
            const info = await stat(dir).catch(() => null);
            if (!info) return { exists: false, empty: true, occupied: false };
            if (!info.isDirectory()) throw new StorageError(400, "项目存放路径不是文件夹");
            const entries = await readdir(dir).catch(() => []);
            return { exists: true, empty: entries.length === 0, occupied: entries.includes("project.json") };
        },

        async createProject(project, canvases, assets = [], storagePath) {
            assertProject(project);
            if (!Array.isArray(canvases) || !canvases.length) throw new StorageError(400, "项目至少需要一张画布");
            if (!Array.isArray(assets)) throw new StorageError(400, "项目资产数据不合法");
            canvases.forEach((canvas) => assertCanvas(canvas, project.id));
            if (typeof storagePath !== "string" || !isAbsolute(storagePath)) throw new StorageError(400, "请选择项目存放文件夹");
            const customDir = resolve(storagePath);
            const info = await stat(customDir).catch(() => null);
            if (info && !info.isDirectory()) throw new StorageError(400, "项目存放路径不是文件夹");
            try {
                await mkdir(customDir, { recursive: true });
                await access(customDir, constants.W_OK);
            } catch {
                throw new StorageError(400, `所选文件夹不可写：${customDir}`);
            }
            const entries = await readdir(customDir).catch(() => []);
            if (entries.includes("project.json")) throw new StorageError(409, "该文件夹已包含项目数据，请选择其他文件夹");
            await updateProjectPaths((paths) => ({ ...paths, [project.id]: customDir }));
            const file = projectFile(project.id);
            try {
                return await enqueue(async () => {
                    if (await pathExists(file)) throw new StorageError(409, "项目已存在");
                    const storedProject = { ...project, schemaVersion: SCHEMA_VERSION, revision: 1 };
                    const storedCanvases = canvases.map((canvas) => ({ ...canvas, schemaVersion: SCHEMA_VERSION, revision: 1 }));
                    await atomicWrite(file, JSON.stringify(storedProject, null, 2));
                    for (const canvas of storedCanvases) await atomicWrite(canvasFile(project.id, canvas.id), JSON.stringify(canvas, null, 2));
                    const summaries = storedCanvases.map(canvasSummary);
                    await atomicWrite(canvasIndexFile(project.id), JSON.stringify(summaries, null, 2));
                    await atomicWrite(projectAssetsFile(project.id), JSON.stringify({ assets }, null, 2));
                    await updateIndexDirect((index) => [projectSummary(storedProject, { assetCount: assets.length }, summaries), ...index.filter((item) => item.id !== project.id)]);
                    return { project: storedProject, canvases: storedCanvases };
                });
            } catch (error) {
                await updateProjectPaths((paths) => {
                    const next = { ...paths };
                    if (next[project.id] === customDir) delete next[project.id];
                    return next;
                }).catch(() => {});
                if (error?.code === "EACCES" || error?.code === "EPERM" || error?.code === "EROFS") {
                    throw new StorageError(400, `所选文件夹不可写：${customDir}`);
                }
                throw error;
            }
        },

        async updateProject(id, patch) {
            if (!patch || typeof patch !== "object") throw new StorageError(400, "项目更新参数不合法");
            const file = projectFile(id);
            return enqueue(async () => {
                const current = assertSchema(await readJson(file), "项目");
                if (patch.title !== undefined && (typeof patch.title !== "string" || !patch.title.trim())) throw new StorageError(400, "项目标题不合法");
                if (patch.activeCanvasId) {
                    const canvases = await readCanvasIndex(id);
                    if (!canvases.some((canvas) => canvas.id === patch.activeCanvasId)) throw new StorageError(400, "活动画布不存在");
                }
                if (patch.production !== undefined && (!patch.production || typeof patch.production !== "object" || patch.production.version !== 1)) throw new StorageError(400, "生产数据不合法");
                const currentRevision = Number.isInteger(current.revision) ? current.revision : 1;
                if (patch.baseRevision !== undefined && (!Number.isInteger(patch.baseRevision) || patch.baseRevision !== currentRevision)) {
                    throw new StorageError(409, "项目数据已被其他窗口更新，请重新打开项目");
                }
                const stored = {
                    ...current,
                    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
                    ...(patch.activeCanvasId !== undefined ? { activeCanvasId: patch.activeCanvasId } : {}),
                    ...(patch.production !== undefined ? { production: patch.production } : {}),
                    updatedAt: new Date().toISOString(),
                    revision: currentRevision + 1,
                };
                await atomicWrite(file, JSON.stringify(stored, null, 2));
                await updateIndexDirect((index) => index.map((item) => item.id === id ? { ...item, title: stored.title, updatedAt: stored.updatedAt, revision: stored.revision } : item));
                return stored;
            });
        },

        async listCanvases(projectId) {
            await readProjectFile(projectId);
            return readCanvasIndex(projectId);
        },

        async readCanvas(projectId, canvasId) {
            return assertSchema(await readJson(canvasFile(projectId, canvasId)), "画布");
        },

        async createCanvas(projectId, canvas) {
            await readProjectFile(projectId);
            assertCanvas(canvas, projectId);
            const file = canvasFile(projectId, canvas.id);
            const stored = { ...canvas, schemaVersion: SCHEMA_VERSION, revision: 1 };
            await enqueue(async () => {
                if (await pathExists(file)) throw new StorageError(409, "画布已存在");
                await atomicWrite(file, JSON.stringify(stored, null, 2));
            });
            const canvases = await updateCanvasIndex(projectId, (index) => [...index.filter((item) => item.id !== stored.id), canvasSummary(stored)]);
            await touchProject(projectId, canvases);
            return stored;
        },

        async saveCanvas(projectId, canvasId, canvas, baseRevision) {
            assertCanvas(canvas, projectId);
            if (canvas.id !== canvasId || !Number.isInteger(baseRevision)) throw new StorageError(400, "画布保存参数不合法");
            const file = canvasFile(projectId, canvasId);
            const stored = await enqueue(async () => {
                const current = assertSchema(await readJson(file), "画布");
                const revision = Number.isInteger(current.revision) ? current.revision : 1;
                if (baseRevision !== revision) throw new StorageError(409, "画布版本冲突");
                const next = { ...canvas, schemaVersion: SCHEMA_VERSION, projectId, id: canvasId, revision: revision + 1 };
                await atomicWrite(file, JSON.stringify(next, null, 2));
                return next;
            });
            const canvases = await updateCanvasIndex(projectId, (index) => index.map((item) => item.id === canvasId ? canvasSummary(stored) : item));
            await touchProject(projectId, canvases);
            return stored;
        },

        async renameCanvas(projectId, canvasId, title) {
            if (typeof title !== "string" || !title.trim()) throw new StorageError(400, "画布标题不合法");
            const file = canvasFile(projectId, canvasId);
            const stored = await enqueue(async () => {
                const current = assertSchema(await readJson(file), "画布");
                const next = { ...current, title: title.trim(), updatedAt: new Date().toISOString(), revision: (Number.isInteger(current.revision) ? current.revision : 1) + 1 };
                await atomicWrite(file, JSON.stringify(next, null, 2));
                return next;
            });
            const canvases = await updateCanvasIndex(projectId, (index) => index.map((item) => item.id === canvasId ? canvasSummary(stored) : item));
            await touchProject(projectId, canvases);
            return stored;
        },

        async deleteCanvas(projectId, canvasId) {
            const currentIndex = await readCanvasIndex(projectId);
            if (currentIndex.length <= 1) throw new StorageError(400, "项目至少需要保留一张画布");
            const file = canvasFile(projectId, canvasId);
            const fileProject = projectFile(projectId);
            return enqueue(async () => {
                await readJson(file);
                const current = await readJson(fileProject);
                const canvases = currentIndex.filter((item) => item.id !== canvasId);
                const stored = {
                    ...current,
                    activeCanvasId: current.activeCanvasId === canvasId ? canvases[0]?.id || null : current.activeCanvasId,
                    updatedAt: new Date().toISOString(),
                };
                await unlink(file);
                await atomicWrite(canvasIndexFile(projectId), JSON.stringify(canvases, null, 2));
                await atomicWrite(fileProject, JSON.stringify(stored, null, 2));
                await updateIndexDirect((index) => index.map((item) => item.id === projectId ? projectSummary(stored, item, canvases) : item));
                return canvases;
            });
        },

        // 删除只做注销，磁盘上的项目文件夹始终保留。
        async deleteProject(id) {
            assertId(id, "项目ID");
            await enqueue(async () => {
                await updateIndexDirect((index) => index.filter((item) => item.id !== id));
            });
        },

        async listMigrations() {
            return readMigrations();
        },

        // 导入项目时需要先登记独立文件夹，之后才能写入媒体。
        async registerProjectLocation(id, storagePath) {
            assertId(id, "项目ID");
            if (typeof storagePath !== "string" || !isAbsolute(storagePath)) throw new StorageError(400, "项目存放路径必须是绝对路径");
            const dir = resolve(storagePath);
            await mkdir(dir, { recursive: true });
            await access(dir, constants.W_OK).catch(() => {
                throw new StorageError(400, `所选文件夹不可写：${dir}`);
            });
            const entries = await readdir(dir).catch(() => []);
            if (entries.includes("project.json")) throw new StorageError(409, "该文件夹已包含项目数据，请选择其他文件夹");
            await updateProjectPaths((paths) => ({ ...paths, [id]: dir }));
            return { projectId: id, storagePath: dir };
        },

        async migrateProject(id, targetParent) {
            assertId(id, "项目ID");
            if (projectPaths[id]) throw new StorageError(409, "该项目已经在独立文件夹中，无需迁移");
            const index = await readIndex();
            const entry = index.find((item) => item.id === id);
            if (!entry) throw new StorageError(404, "项目索引不存在");
            const source = legacyProjectDir(id);
            const sourceProjectFile = join(source, "project.json");
            const sourceInfo = await stat(sourceProjectFile).catch(() => null);
            if (!sourceInfo?.isFile()) throw new StorageError(404, `未找到待迁移的项目数据：${source}`);
            if (typeof targetParent !== "string" || !isAbsolute(targetParent)) throw new StorageError(400, "请选择迁移目标文件夹");
            const parent = resolve(targetParent);
            await mkdir(parent, { recursive: true });
            await access(parent, constants.W_OK).catch(() => {
                throw new StorageError(400, `所选文件夹不可写：${parent}`);
            });
            const target = join(parent, `${safeFolderName(entry.title, "project")}-${id}`);
            if (await pathExists(target)) throw new StorageError(409, "目标文件夹已存在，请选择其他位置");
            const temporary = join(parent, `.migrating-${id}-${Date.now()}`);
            await cp(source, temporary, { recursive: true });
            try {
                const sourceProject = JSON.parse(await readFile(sourceProjectFile, "utf8"));
                const targetProject = JSON.parse(await readFile(join(temporary, "project.json"), "utf8"));
                if (targetProject.id !== sourceProject.id) throw new StorageError(500, "迁移校验失败：项目 ID 不一致");
                const before = await folderStats(source);
                const after = await folderStats(temporary);
                if (before.files !== after.files || before.bytes !== after.bytes) throw new StorageError(500, "迁移校验失败：文件数量或大小不一致");
                await withRetry(() => rename(temporary, target));
                await enqueue(async () => {
                    await updateProjectPathsDirect((paths) => ({ ...paths, [id]: target }));
                    await updateMigrationsDirect((data) => ({
                        migrations: [...data.migrations, {
                            projectId: id,
                            title: entry.title,
                            from: source,
                            to: target,
                            backupPath: source,
                            status: "done",
                            completedAt: new Date().toISOString(),
                        }],
                    }));
                });
                return { projectId: id, from: source, to: target, backupPath: source };
            } catch (error) {
                if (error instanceof StorageError) throw error;
                throw new StorageError(500, `迁移失败，原项目未改动；临时目录：${temporary}`);
            }
        },

        async rollbackMigration(projectId) {
            assertId(projectId, "项目ID");
            const migrations = await readMigrations();
            const record = [...migrations].reverse().find((item) => item.projectId === projectId && item.status === "done");
            if (!record) throw new StorageError(404, "没有可回滚的迁移记录");
            const sourceProjectFile = join(record.from, "project.json");
            const sourceInfo = await stat(sourceProjectFile).catch(() => null);
            if (!sourceInfo?.isFile()) throw new StorageError(409, "原目录已不存在，无法回滚");
            await enqueue(async () => {
                await updateProjectPathsDirect((paths) => ({ ...paths, [projectId]: record.from }));
                await updateMigrationsDirect((data) => ({
                    migrations: [...data.migrations, {
                        ...record,
                        status: "rolled-back",
                        rolledBackAt: new Date().toISOString(),
                    }],
                }));
            });
            return { projectId, restored: record.from };
        },

        async readProjectAssets(projectId) {
            await readProjectFile(projectId);
            const data = await readJson(projectAssetsFile(projectId), { assets: [] });
            return { assets: Array.isArray(data.assets) ? data.assets : [] };
        },

        async saveProjectAssets(projectId, assets) {
            if (!Array.isArray(assets)) throw new StorageError(400, "项目资产数据不合法");
            await readProjectFile(projectId);
            const file = projectAssetsFile(projectId);
            await enqueue(() => atomicWrite(file, JSON.stringify({ assets }, null, 2)));
            await updateProjectAssetsSummary(projectId, assets);
            return { assets };
        },

        async addProjectAsset(projectId, asset) {
            if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new StorageError(400, "项目资产数据不合法");
            assertId(asset.id, "资产ID");
            await readProjectFile(projectId);
            const file = projectAssetsFile(projectId);
            const assets = await enqueue(async () => {
                const data = await readJson(file, { assets: [] });
                const current = Array.isArray(data.assets) ? data.assets : [];
                const next = [...current.filter((item) => item.id !== asset.id), asset];
                await atomicWrite(file, JSON.stringify({ assets: next }, null, 2));
                return next;
            });
            await updateProjectAssetsSummary(projectId, assets);
            return { assets };
        },

        async readAssets() {
            const data = await readJson(assetsFile, { assets: [] });
            return { assets: Array.isArray(data.assets) ? data.assets : [] };
        },

        async saveAssets(assets) {
            if (!Array.isArray(assets)) throw new StorageError(400, "素材数据不合法");
            await enqueue(() => atomicWrite(assetsFile, JSON.stringify({ assets }, null, 2)));
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

        async importMedia(storageKey, sourcePath, mimeType) {
            if (typeof sourcePath !== "string" || !sourcePath) throw new StorageError(400, "本地文件路径不合法");
            const file = resolve(sourcePath);
            const info = await stat(file).catch(() => null);
            if (!info?.isFile()) throw new StorageError(400, "本地文件不存在或不是文件");
            const target = mediaPaths(await parseMediaKey(storageKey));
            const normalizedMimeType = normalizeMimeType(mimeType);
            await copyParts({ file }, target, normalizedMimeType);
            return { storageKey, bytes: info.size, mimeType: normalizedMimeType };
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
            return saveMedia(storageKey, Readable.fromWeb(response.body), mimeType || response.headers.get("content-type"));
        },

        async saveCandidatePoster(id, input) {
            const file = join(root, "cache", "candidate-posters", `${assertId(id, "候选ID")}.webp`);
            await enqueue(() => atomicStream(file, input));
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

        drain,
    };
}
