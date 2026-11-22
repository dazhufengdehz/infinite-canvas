import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { hasStorageServer, isDesktopRuntime, storageRequest } from "@/services/api/storage";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasDocument, CanvasDocumentSummary, CanvasProject, CanvasProjectBundle, CanvasProjectSummary } from "@/types/canvas";

export const CANVAS_SCHEMA_VERSION = 2;

const PROJECT_INDEX_KEY = "infinite-canvas:canvas_project_index";
const ASSET_STORE_KEY = "infinite-canvas:asset_store";
const projectKey = (id: string) => `infinite-canvas:canvas_project:${id}`;
const canvasIndexKey = (id: string) => `infinite-canvas:canvas_index:${id}`;
const canvasKey = (projectId: string, canvasId: string) => `infinite-canvas:canvas_document:${projectId}:${canvasId}`;
const projectAssetsKey = (id: string) => `infinite-canvas:project_assets:${id}`;
const projectAssetQueues = new Map<string, Promise<unknown>>();
const canvasIndexQueues = new Map<string, Promise<unknown>>();
let projectIndexQueue: Promise<unknown> = Promise.resolve();

type LocalAssetState = { state?: { assets?: Asset[] } };

async function readLocal<T>(key: string, fallback: T): Promise<T> {
    const raw = await localForageStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
}

async function writeLocal(key: string, value: unknown) {
    await localForageStorage.setItem(key, JSON.stringify(value));
}

function assertLocalSchema<T extends { schemaVersion?: number }>(value: T | null, label: string): T | null {
    if (!value) return value;
    if (value.schemaVersion !== CANVAS_SCHEMA_VERSION) throw new Error(`${label}数据格式版本不兼容，请从导出备份恢复或重建项目`);
    return value;
}

function updateLocalProjectIndex(update: (projects: CanvasProjectSummary[]) => CanvasProjectSummary[]) {
    const next = projectIndexQueue.catch(() => {}).then(async () => {
        const value = update(await readLocal<CanvasProjectSummary[]>(PROJECT_INDEX_KEY, []));
        await writeLocal(PROJECT_INDEX_KEY, value);
        return value;
    });
    projectIndexQueue = next;
    return next;
}

function updateLocalCanvasIndex(projectId: string, update: (canvases: CanvasDocumentSummary[]) => CanvasDocumentSummary[]) {
    const previous = canvasIndexQueues.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
        const value = update(await readLocal<CanvasDocumentSummary[]>(canvasIndexKey(projectId), []));
        await writeLocal(canvasIndexKey(projectId), value);
        return value;
    });
    canvasIndexQueues.set(projectId, next);
    return next.finally(() => {
        if (canvasIndexQueues.get(projectId) === next) canvasIndexQueues.delete(projectId);
    });
}

export function canvasSummary(canvas: CanvasDocument): CanvasDocumentSummary {
    return {
        id: canvas.id,
        projectId: canvas.projectId,
        title: canvas.title,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
        revision: canvas.revision,
        nodeCount: canvas.nodes.length,
        connectionCount: canvas.connections.length,
    };
}

export function projectSummary(project: CanvasProject, canvases: CanvasDocumentSummary[], assetCount = 0): CanvasProjectSummary {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        revision: project.revision,
        canvasCount: canvases.length,
        nodeCount: canvases.reduce((total, canvas) => total + canvas.nodeCount, 0),
        connectionCount: canvases.reduce((total, canvas) => total + canvas.connectionCount, 0),
        assetCount,
    };
}

export async function listProjects() {
    if (await hasStorageServer()) return storageRequest<CanvasProjectSummary[]>("/projects");
    return readLocal<CanvasProjectSummary[]>(PROJECT_INDEX_KEY, []);
}

export async function readProject(id: string) {
    if (await hasStorageServer()) return storageRequest<CanvasProject>(`/projects/${encodeURIComponent(id)}`);
    return assertLocalSchema(await readLocal<CanvasProject | null>(projectKey(id), null), "项目");
}

export async function listStoredCanvases(projectId: string) {
    if (await hasStorageServer()) return storageRequest<CanvasDocumentSummary[]>(`/projects/${encodeURIComponent(projectId)}/canvases`);
    return readLocal<CanvasDocumentSummary[]>(canvasIndexKey(projectId), []);
}

export async function readStoredCanvas(projectId: string, canvasId: string) {
    if (await hasStorageServer()) return storageRequest<CanvasDocument>(`/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}`);
    return assertLocalSchema(await readLocal<CanvasDocument | null>(canvasKey(projectId, canvasId), null), "画布");
}

export async function readProjectBundle(id: string): Promise<CanvasProjectBundle | null> {
    const project = await readProject(id);
    if (!project) return null;
    const summaries = await listStoredCanvases(id);
    const canvases: CanvasDocument[] = [];
    for (const summary of summaries) {
        const canvas = await readStoredCanvas(id, summary.id);
        if (canvas) canvases.push(canvas);
    }
    return { ...project, canvases, assets: await readProjectAssets(id) };
}

export async function readProjects(ids?: string[]) {
    const summaries = await listProjects();
    const selected = ids ? summaries.filter((item) => ids.includes(item.id)) : summaries;
    const projects: CanvasProjectBundle[] = [];
    for (const item of selected) {
        const project = await readProjectBundle(item.id);
        if (project) projects.push(project);
    }
    return projects;
}

export async function checkStoredProjectFolder(storagePath: string) {
    if (await hasStorageServer()) {
        return storageRequest<{ exists: boolean; empty: boolean; occupied: boolean }>("/projects/check-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: storagePath }),
        });
    }
    return { exists: false, empty: true, occupied: false };
}

export async function createStoredProject(project: CanvasProject, canvases: CanvasDocument[], assets: Asset[] = [], storagePath?: string) {
    if (await hasStorageServer()) {
        if (isDesktopRuntime() && !storagePath) throw new Error("请选择项目存放文件夹");
        return storageRequest<{ project: CanvasProject; canvases: CanvasDocument[] }>("/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project: { ...project, schemaVersion: CANVAS_SCHEMA_VERSION },
                canvases: canvases.map((canvas) => ({ ...canvas, schemaVersion: CANVAS_SCHEMA_VERSION })),
                assets,
                storagePath,
            }),
        });
    }
    const storedProject = { ...project, schemaVersion: CANVAS_SCHEMA_VERSION, revision: 1 };
    const storedCanvases = canvases.map((canvas) => ({ ...canvas, schemaVersion: CANVAS_SCHEMA_VERSION, revision: 1 }));
    try {
        await writeLocal(projectKey(project.id), storedProject);
        await writeLocal(canvasIndexKey(project.id), storedCanvases.map(canvasSummary));
        for (const canvas of storedCanvases) await writeLocal(canvasKey(project.id, canvas.id), canvas);
        await writeLocal(projectAssetsKey(project.id), assets);
        const summary = projectSummary(storedProject, storedCanvases.map(canvasSummary), assets.length);
        await updateLocalProjectIndex((projects) => [summary, ...projects.filter((item) => item.id !== project.id)]);
        return { project: storedProject, canvases: storedCanvases };
    } catch (error) {
        await Promise.all([
            localForageStorage.removeItem(projectKey(project.id)),
            localForageStorage.removeItem(canvasIndexKey(project.id)),
            localForageStorage.removeItem(projectAssetsKey(project.id)),
            ...storedCanvases.map((canvas) => localForageStorage.removeItem(canvasKey(project.id, canvas.id))),
        ]).catch(() => {});
        throw error;
    }
}

export async function updateStoredProject(id: string, patch: Partial<Pick<CanvasProject, "title" | "activeCanvasId" | "production">>) {
    if (await hasStorageServer()) {
        return storageRequest<CanvasProject>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    }
    const current = await readProject(id);
    if (!current) throw new Error("项目不存在");
    const stored = { ...current, ...patch, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    await writeLocal(projectKey(id), stored);
    await updateLocalProjectIndex((projects) => projects.map((item) => (item.id === id ? { ...item, title: stored.title, updatedAt: stored.updatedAt, revision: stored.revision } : item)));
    return stored;
}

export async function renameStoredProject(id: string, title: string) {
    return updateStoredProject(id, { title });
}

export async function setActiveStoredCanvas(projectId: string, canvasId: string) {
    return updateStoredProject(projectId, { activeCanvasId: canvasId });
}

export async function createStoredCanvas(canvas: CanvasDocument) {
    if (await hasStorageServer()) {
        return storageRequest<CanvasDocument>(`/projects/${encodeURIComponent(canvas.projectId)}/canvases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvas }),
        });
    }
    const stored = { ...canvas, schemaVersion: CANVAS_SCHEMA_VERSION, revision: 1 };
    await writeLocal(canvasKey(stored.projectId, stored.id), stored);
    const next = await updateLocalCanvasIndex(canvas.projectId, (canvases) => [...canvases.filter((item) => item.id !== stored.id), canvasSummary(stored)]);
    await touchLocalProject(stored.projectId, next);
    return stored;
}

export async function saveStoredCanvas(canvas: CanvasDocument, baseRevision: number) {
    if (await hasStorageServer()) {
        return storageRequest<CanvasDocument>(`/projects/${encodeURIComponent(canvas.projectId)}/canvases/${encodeURIComponent(canvas.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvas, baseRevision }),
        });
    }
    const stored = { ...canvas, schemaVersion: CANVAS_SCHEMA_VERSION, revision: baseRevision + 1 };
    await writeLocal(canvasKey(stored.projectId, stored.id), stored);
    const next = await updateLocalCanvasIndex(stored.projectId, (canvases) => canvases.map((item) => (item.id === stored.id ? canvasSummary(stored) : item)));
    await touchLocalProject(stored.projectId, next);
    return stored;
}

export async function renameStoredCanvas(projectId: string, canvasId: string, title: string) {
    if (await hasStorageServer()) {
        return storageRequest<CanvasDocument>(`/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
        });
    }
    const current = await readStoredCanvas(projectId, canvasId);
    if (!current) throw new Error("画布不存在");
    const stored = { ...current, title: title.trim(), updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    await writeLocal(canvasKey(projectId, canvasId), stored);
    const next = await updateLocalCanvasIndex(projectId, (canvases) => canvases.map((item) => (item.id === canvasId ? canvasSummary(stored) : item)));
    await touchLocalProject(projectId, next);
    return stored;
}

export async function deleteStoredCanvas(projectId: string, canvasId: string) {
    if (await hasStorageServer()) {
        return storageRequest<CanvasDocumentSummary[]>(`/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}`, { method: "DELETE" });
    }
    const canvases = await listStoredCanvases(projectId);
    if (!canvases.some((item) => item.id === canvasId)) throw new Error("画布不存在");
    if (canvases.length <= 1) throw new Error("项目至少需要保留一张画布");
    await localForageStorage.removeItem(canvasKey(projectId, canvasId));
    const next = await updateLocalCanvasIndex(projectId, (items) => items.filter((item) => item.id !== canvasId));
    await touchLocalProject(projectId, next);
    return next;
}

async function touchLocalProject(projectId: string, canvases: CanvasDocumentSummary[]) {
    const project = await readProject(projectId);
    if (!project) return;
    const updatedAt = new Date().toISOString();
    await writeLocal(projectKey(projectId), { ...project, updatedAt });
    await updateLocalProjectIndex((projects) => projects.map((item) => (item.id === projectId ? projectSummary({ ...project, updatedAt }, canvases, item.assetCount) : item)));
}

export async function deleteStoredProjects(ids: string[]) {
    if (await hasStorageServer()) {
        for (const id of ids) await storageRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
        return;
    }
    for (const id of ids) {
        const canvases = await listStoredCanvases(id);
        for (const canvas of canvases) await localForageStorage.removeItem(canvasKey(id, canvas.id));
        await localForageStorage.removeItem(canvasIndexKey(id));
        await localForageStorage.removeItem(projectAssetsKey(id));
        await localForageStorage.removeItem(projectKey(id));
    }
    await updateLocalProjectIndex((projects) => projects.filter((project) => !ids.includes(project.id)));
}

export async function replaceStoredProjects(projects: CanvasProjectBundle[]) {
    // 桌面端项目与磁盘文件夹一一对应，不能像浏览器存储那样整体覆盖。
    if (isDesktopRuntime()) throw new Error("桌面端不支持覆盖式同步，请使用项目导出/导入");
    const existing = await listProjects();
    await deleteStoredProjects(existing.map((item) => item.id));
    for (const project of projects) {
        const id = project.id || nanoid();
        const { canvases, assets, ...metadata } = project;
        await createStoredProject({ ...metadata, id }, canvases.map((canvas) => ({ ...canvas, projectId: id })), assets.map((asset) => ({ ...asset, scope: { type: "project", projectId: id } })));
    }
}

export async function readProjectAssets(projectId: string) {
    if (await hasStorageServer()) return (await storageRequest<{ assets: Asset[] }>(`/projects/${encodeURIComponent(projectId)}/assets`)).assets;
    return readLocal<Asset[]>(projectAssetsKey(projectId), []);
}

async function saveLocalProjectAssets(projectId: string, assets: Asset[]) {
    await writeLocal(projectAssetsKey(projectId), assets);
    const project = await readProject(projectId);
    if (!project) return;
    const updatedAt = new Date().toISOString();
    await writeLocal(projectKey(projectId), { ...project, updatedAt });
    const canvases = await listStoredCanvases(projectId);
    await updateLocalProjectIndex((projects) => projects.map((item) => (item.id === projectId ? projectSummary({ ...project, updatedAt }, canvases, assets.length) : item)));
}

export async function saveStoredProjectAssets(projectId: string, assets: Asset[]) {
    if (await hasStorageServer()) {
        await storageRequest(`/projects/${encodeURIComponent(projectId)}/assets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assets }) });
        return assets;
    }
    await saveLocalProjectAssets(projectId, assets);
    return assets;
}

export async function addStoredProjectAsset(projectId: string, asset: Asset) {
    if (await hasStorageServer()) {
        return (await storageRequest<{ assets: Asset[] }>(`/projects/${encodeURIComponent(projectId)}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asset }),
        })).assets;
    }
    const previous = projectAssetQueues.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
        const assets = [...(await readProjectAssets(projectId)).filter((item) => item.id !== asset.id), asset];
        await saveLocalProjectAssets(projectId, assets);
        return assets;
    });
    projectAssetQueues.set(projectId, next);
    return next.finally(() => {
        if (projectAssetQueues.get(projectId) === next) projectAssetQueues.delete(projectId);
    });
}

export async function readAssets() {
    if (await hasStorageServer()) return (await storageRequest<{ assets: Asset[] }>("/assets")).assets;
    const raw = await localForageStorage.getItem(ASSET_STORE_KEY);
    return raw ? (JSON.parse(raw) as LocalAssetState).state?.assets || [] : [];
}

export async function saveAssets(assets: Asset[]) {
    if (await hasStorageServer()) {
        await storageRequest("/assets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assets }) });
        return;
    }
    await localForageStorage.setItem(ASSET_STORE_KEY, JSON.stringify({ state: { assets }, version: 0 }));
}

export type StoredProjectMigration = {
    projectId: string;
    title: string;
    from: string;
    to: string;
    backupPath: string;
    status: "done" | "rolled-back";
    completedAt: string;
    rolledBackAt?: string;
};

export async function registerStoredProjectLocation(projectId: string, storagePath: string) {
    return storageRequest<{ projectId: string; storagePath: string }>(`/projects/${encodeURIComponent(projectId)}/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath }),
    });
}

export async function migrateStoredProject(projectId: string, targetParent: string) {
    return storageRequest<{ projectId: string; from: string; to: string; backupPath: string }>(`/projects/${encodeURIComponent(projectId)}/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetParent }),
    });
}

export async function rollbackStoredMigration(projectId: string) {
    return storageRequest<{ projectId: string; restored: string }>(`/projects/${encodeURIComponent(projectId)}/migrate/rollback`, { method: "POST" });
}

export async function readStoredMigrations() {
    return storageRequest<StoredProjectMigration[]>("/migrations");
}

export function scopedStorageKey(kind: string, ownerId = "assets") {
    return `${kind}:${ownerId === "assets" ? "assets" : `p_${ownerId}`}_m${nanoid()}`;
}
