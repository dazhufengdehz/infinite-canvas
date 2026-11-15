import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";
import { hasStorageServer, storageRequest } from "@/services/api/storage";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject, CanvasProjectSummary } from "@/stores/canvas/use-canvas-store";

const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
const ASSET_STORE_KEY = "infinite-canvas:asset_store";

type LocalCanvasState = { state?: { projects?: CanvasProject[] } };
type LocalAssetState = { state?: { assets?: Asset[] } };

async function readLocalProjects() {
    const raw = await localForageStorage.getItem(CANVAS_STORE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as LocalCanvasState).state?.projects || [];
}

async function writeLocalProjects(projects: CanvasProject[]) {
    await localForageStorage.setItem(CANVAS_STORE_KEY, JSON.stringify({ state: { projects }, version: 0 }));
}

export function projectSummary(project: CanvasProject): CanvasProjectSummary {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        revision: project.revision || 1,
        nodeCount: project.nodes.length,
        connectionCount: project.connections.length,
    };
}

export async function listProjects() {
    if (await hasStorageServer()) return storageRequest<CanvasProjectSummary[]>("/projects");
    return (await readLocalProjects()).map(projectSummary);
}

export async function readProject(id: string) {
    if (await hasStorageServer()) return storageRequest<CanvasProject>(`/projects/${encodeURIComponent(id)}`);
    return (await readLocalProjects()).find((project) => project.id === id) || null;
}

export async function readProjects(ids?: string[]) {
    if (await hasStorageServer()) {
        const summaries = await listProjects();
        const selected = ids ? summaries.filter((item) => ids.includes(item.id)) : summaries;
        const projects: CanvasProject[] = [];
        for (const item of selected) {
            const project = await readProject(item.id);
            if (project) projects.push(project);
        }
        return projects;
    }
    const projects = await readLocalProjects();
    return ids ? projects.filter((project) => ids.includes(project.id)) : projects;
}

export async function createStoredProject(project: CanvasProject) {
    if (await hasStorageServer()) return storageRequest<CanvasProject>("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) });
    const projects = await readLocalProjects();
    const stored = { ...project, revision: 1 };
    await writeLocalProjects([stored, ...projects.filter((item) => item.id !== stored.id)]);
    return stored;
}

export async function saveStoredProject(project: CanvasProject, baseRevision: number) {
    if (await hasStorageServer()) {
        return storageRequest<CanvasProject>(`/projects/${encodeURIComponent(project.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project, baseRevision }),
        });
    }
    const projects = await readLocalProjects();
    const stored = { ...project, revision: baseRevision + 1 };
    await writeLocalProjects(projects.some((item) => item.id === project.id) ? projects.map((item) => (item.id === project.id ? stored : item)) : [stored, ...projects]);
    return stored;
}

export async function renameStoredProject(id: string, title: string) {
    if (await hasStorageServer()) return storageRequest<CanvasProjectSummary>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    const projects = await readLocalProjects();
    const next = projects.map((project) => (project.id === id ? { ...project, title, updatedAt: new Date().toISOString(), revision: (project.revision || 1) + 1 } : project));
    await writeLocalProjects(next);
    const project = next.find((item) => item.id === id);
    if (!project) throw new Error("项目不存在");
    return projectSummary(project);
}

export async function deleteStoredProjects(ids: string[]) {
    if (await hasStorageServer()) {
        for (const id of ids) await storageRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
        return;
    }
    await writeLocalProjects((await readLocalProjects()).filter((project) => !ids.includes(project.id)));
}

export async function replaceStoredProjects(projects: CanvasProject[]) {
    const existing = await listProjects();
    const existingById = new Map(existing.map((item) => [item.id, item]));
    await deleteStoredProjects(existing.filter((item) => !projects.some((project) => project.id === item.id)).map((item) => item.id));
    for (const project of projects) {
        const id = project.id || nanoid();
        const current = existingById.get(id);
        if (current) await saveStoredProject({ ...project, id }, current.revision);
        else await createStoredProject({ ...project, id });
    }
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

export function scopedStorageKey(kind: string, ownerId = "assets") {
    return `${kind}:${ownerId === "assets" ? "assets" : `p_${ownerId}`}_${nanoid()}`;
}
