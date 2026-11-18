import { create } from "zustand";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import {
    canvasSummary,
    createStoredCanvas,
    createStoredProject,
    deleteStoredCanvas,
    deleteStoredProjects,
    listProjects,
    listStoredCanvases,
    projectSummary,
    readProject,
    readStoredCanvas,
    renameStoredCanvas,
    renameStoredProject,
    replaceStoredProjects,
    saveStoredCanvas,
    setActiveStoredCanvas,
} from "@/services/project-storage";
import type { CanvasDocument, CanvasDocumentPatch, CanvasDocumentSummary, CanvasNodeData, CanvasNodeMetadata, CanvasProject, CanvasProjectBundle, CanvasProjectSummary, ViewportTransform } from "@/types/canvas";
import type { Asset } from "@/stores/use-asset-store";

export type { CanvasDocument, CanvasDocumentPatch, CanvasDocumentSummary, CanvasProject, CanvasProjectBundle, CanvasProjectSummary } from "@/types/canvas";

export type CanvasWorkspace = {
    project: CanvasProject;
    canvases: CanvasDocumentSummary[];
    canvas: CanvasDocument;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProjectSummary[];
    activeProject: CanvasProject | null;
    activeCanvas: CanvasDocument | null;
    canvases: CanvasDocumentSummary[];
    storageError: string | null;
    createProject: (title?: string, id?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProjectBundle>, id?: string, storageKeyMap?: Map<string, string>) => Promise<string>;
    openProject: (id: string, canvasId?: string) => Promise<CanvasWorkspace | null>;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProjectBundle[]) => Promise<void>;
    createCanvas: (projectId: string, title?: string) => Promise<CanvasDocument>;
    duplicateCanvas: (projectId: string, canvasId: string) => Promise<CanvasDocument>;
    renameCanvas: (projectId: string, canvasId: string, title: string) => Promise<void>;
    deleteCanvas: (projectId: string, canvasId: string) => Promise<string | null>;
    updateCanvas: (projectId: string, canvasId: string, patch: CanvasDocumentPatch) => void;
    setProjectAssetCount: (projectId: string, count: number) => void;
    flushProject: () => Promise<void>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveQueues = new Map<string, Promise<void>>();
const dirtyCanvases = new Map<string, CanvasDocument>();

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "项目存储失败";
}

function canvasKey(projectId: string, canvasId: string) {
    return `${projectId}/${canvasId}`;
}

function upsertSummary(projects: CanvasProjectSummary[], project: CanvasProject, canvases: CanvasDocumentSummary[], assetCount?: number) {
    const current = projects.find((item) => item.id === project.id);
    const summary = projectSummary(project, canvases, assetCount ?? current?.assetCount ?? 0);
    return projects.some((item) => item.id === project.id) ? projects.map((item) => (item.id === project.id ? summary : item)) : [summary, ...projects];
}

function makeProject(title: string, id = nanoid(), source: Partial<CanvasProject> = {}): CanvasProject {
    const now = new Date().toISOString();
    return {
        id,
        title,
        createdAt: source.createdAt || now,
        updatedAt: now,
        revision: 1,
        activeCanvasId: source.activeCanvasId || null,
    };
}

function makeCanvas(projectId: string, title: string, id = nanoid(), source: Partial<CanvasDocument> = {}): CanvasDocument {
    const now = new Date().toISOString();
    return {
        id,
        projectId,
        title,
        createdAt: source.createdAt || now,
        updatedAt: now,
        revision: 1,
        nodes: source.nodes || [],
        connections: source.connections || [],
        chatSessions: source.chatSessions || [],
        activeChatId: source.activeChatId || null,
        backgroundMode: source.backgroundMode || "lines",
        showImageInfo: source.showImageInfo || false,
        viewport: source.viewport || initialViewport,
    };
}

function requiredImportedId(map: Map<string, string>, id: string, label: string) {
    const mapped = map.get(id);
    if (!mapped) throw new Error(`导入数据缺少${label}引用：${id}`);
    return mapped;
}

function remapImportedMediaValue<T extends string | undefined>(value: T, storageKeyMap: Map<string, string>): T {
    if (!value || value.startsWith("data:") || value.startsWith("blob:")) return value;
    let next: string = value;
    storageKeyMap.forEach((replacement, storageKey) => {
        next = next.split(storageKey).join(replacement).split(encodeURIComponent(storageKey)).join(encodeURIComponent(replacement));
    });
    return next as T;
}

function remapImportedMentions<T extends string | undefined>(value: T, nodeIdMap: Map<string, string>): T {
    return value?.replace(/@\[node:([\w-]+)\]/g, (mention, id: string) => nodeIdMap.has(id) ? `@[node:${nodeIdMap.get(id)}]` : mention) as T;
}

function remapImportedMetadata(metadata: CanvasNodeMetadata | undefined, nodeIdMap: Map<string, string>, assetIdMap: Map<string, string>, storageKeyMap: Map<string, string>) {
    if (!metadata) return metadata;
    return {
        ...metadata,
        assetId: metadata.assetId ? requiredImportedId(assetIdMap, metadata.assetId, "资产") : undefined,
        groupId: metadata.groupId ? requiredImportedId(nodeIdMap, metadata.groupId, "组节点") : undefined,
        generationOriginNodeId: metadata.generationOriginNodeId ? requiredImportedId(nodeIdMap, metadata.generationOriginNodeId, "生成来源节点") : undefined,
        storageKey: remapImportedMediaValue(metadata.storageKey, storageKeyMap),
        posterStorageKey: remapImportedMediaValue(metadata.posterStorageKey, storageKeyMap),
        content: remapImportedMediaValue(metadata.content, storageKeyMap),
        posterUrl: remapImportedMediaValue(metadata.posterUrl, storageKeyMap),
        composerContent: remapImportedMentions(metadata.composerContent, nodeIdMap),
        prompt: remapImportedMentions(metadata.prompt, nodeIdMap),
        effectivePrompt: remapImportedMentions(metadata.effectivePrompt, nodeIdMap),
        references: metadata.references?.map((url) => remapImportedMediaValue(url, storageKeyMap)),
        images: metadata.images?.map((image) => ({ ...image, storageKey: remapImportedMediaValue(image.storageKey, storageKeyMap), content: remapImportedMediaValue(image.content, storageKeyMap) })),
        generationReferences: metadata.generationReferences?.map((reference) => ({
            ...reference,
            nodeId: requiredImportedId(nodeIdMap, reference.nodeId, "生成参考节点"),
            storageKey: remapImportedMediaValue(reference.storageKey, storageKeyMap),
            url: remapImportedMediaValue(reference.url, storageKeyMap),
        })),
    };
}

function remapImportedAsset(asset: Asset, projectId: string, sourceProjectId: string | undefined, assetIdMap: Map<string, string>, canvasIdMap: Map<string, string>, canvasNodeMaps: Map<string, Map<string, string>>, nodeIdMap: Map<string, string>, storageKeyMap: Map<string, string>): Asset {
    const sourceAssetId = asset.metadata?.sourceAssetId;
    const origin = asset.origin;
    const originNodeMap = origin?.canvasId ? canvasNodeMaps.get(origin.canvasId) : undefined;
    const fromSourceProject = origin?.projectId === sourceProjectId;
    const base = {
        ...asset,
        id: requiredImportedId(assetIdMap, asset.id, "资产"),
        scope: { type: "project" as const, projectId },
        coverUrl: remapImportedMediaValue(asset.coverUrl, storageKeyMap),
        origin: origin ? {
            ...origin,
            projectId: fromSourceProject ? projectId : origin.projectId,
            canvasId: fromSourceProject && origin.canvasId ? requiredImportedId(canvasIdMap, origin.canvasId, "资产来源画布") : origin.canvasId,
            nodeId: fromSourceProject && origin.nodeId ? requiredImportedId(originNodeMap || nodeIdMap, origin.nodeId, "资产来源节点") : origin.nodeId,
        } : undefined,
        metadata: asset.metadata ? { ...asset.metadata, sourceAssetId: typeof sourceAssetId === "string" ? assetIdMap.get(sourceAssetId) || sourceAssetId : sourceAssetId } : undefined,
    };
    if (asset.kind === "text") return { ...base, kind: "text", data: { ...asset.data } };
    if (asset.kind === "image") return { ...base, kind: "image", data: { ...asset.data, storageKey: remapImportedMediaValue(asset.data.storageKey, storageKeyMap), dataUrl: remapImportedMediaValue(asset.data.dataUrl, storageKeyMap) } };
    if (asset.kind === "video") return { ...base, kind: "video", data: { ...asset.data, storageKey: remapImportedMediaValue(asset.data.storageKey, storageKeyMap), posterStorageKey: remapImportedMediaValue(asset.data.posterStorageKey, storageKeyMap), url: remapImportedMediaValue(asset.data.url, storageKeyMap), posterUrl: remapImportedMediaValue(asset.data.posterUrl, storageKeyMap) } };
    return { ...base, kind: "audio", data: { ...asset.data, storageKey: remapImportedMediaValue(asset.data.storageKey, storageKeyMap), url: remapImportedMediaValue(asset.data.url, storageKeyMap) } };
}

async function persistCanvas(key: string) {
    const canvas = dirtyCanvases.get(key);
    if (!canvas) return;
    try {
        const saved = await saveStoredCanvas(canvas, canvas.revision);
        const latest = dirtyCanvases.get(key);
        if (latest === canvas) dirtyCanvases.delete(key);
        else if (latest) dirtyCanvases.set(key, { ...latest, revision: saved.revision });
        useCanvasStore.setState((state) => {
            if (state.activeProject?.id !== saved.projectId) return { storageError: null };
            const activeCanvas = state.activeCanvas?.id === saved.id ? { ...state.activeCanvas, revision: saved.revision } : state.activeCanvas;
            const current = activeCanvas?.id === saved.id ? activeCanvas : saved;
            const canvases = state.canvases.map((item) => (item.id === saved.id ? canvasSummary(current) : item));
            return {
                activeCanvas,
                canvases,
                projects: upsertSummary(state.projects, state.activeProject, canvases),
                storageError: null,
            };
        });
    } catch (error) {
        useCanvasStore.setState({ storageError: errorMessage(error) });
    }
}

function enqueueSave(key: string) {
    const previous = saveQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => persistCanvas(key));
    saveQueues.set(key, next);
    return next.finally(() => {
        if (saveQueues.get(key) === next) saveQueues.delete(key);
    });
}

function flushCanvas(projectId: string, canvasId: string) {
    const key = canvasKey(projectId, canvasId);
    const timer = saveTimers.get(key);
    if (timer) clearTimeout(timer);
    saveTimers.delete(key);
    const pending = dirtyCanvases.has(key) ? enqueueSave(key) : saveQueues.get(key);
    return pending || Promise.resolve();
}

export const useCanvasStore = create<CanvasStore>()((set, get) => {
    const flushProject = async () => {
        const keys = new Set([...dirtyCanvases.keys(), ...saveTimers.keys(), ...saveQueues.keys()]);
        await Promise.all([...keys].map((key) => {
            const [projectId, canvasId] = key.split("/");
            return flushCanvas(projectId, canvasId);
        }));
    };

    const scheduleSave = (projectId: string, canvasId: string) => {
        const key = canvasKey(projectId, canvasId);
        const timer = saveTimers.get(key);
        if (timer) clearTimeout(timer);
        saveTimers.set(key, setTimeout(() => {
            saveTimers.delete(key);
            void enqueueSave(key);
        }, 400));
    };

    return {
        hydrated: false,
        projects: [],
        activeProject: null,
        activeCanvas: null,
        canvases: [],
        storageError: null,
        createProject: async (title = i18n.t("canvas.project.untitled"), id) => {
            const project = makeProject(title, id);
            const canvas = makeCanvas(project.id, i18n.t("canvas.documents.defaultTitle"));
            project.activeCanvasId = canvas.id;
            const stored = await createStoredProject(project, [canvas]);
            set((state) => ({ projects: upsertSummary(state.projects, stored.project, stored.canvases.map(canvasSummary)), storageError: null }));
            return stored.project.id;
        },
        importProject: async (source, id, storageKeyMap = new Map()) => {
            const project = makeProject(source.title || i18n.t("canvas.project.imported"), id, source);
            const sourceCanvases: Array<Partial<CanvasDocument>> = source.canvases?.length ? source.canvases : [{}];
            const newCanvasIds = sourceCanvases.map(() => nanoid());
            const canvasIdMap = new Map<string, string>();
            const canvasNodeMaps = new Map<string, Map<string, string>>();
            const nodeIdMap = new Map<string, string>();
            const nodeMaps = sourceCanvases.map((canvas, index) => {
                if (canvas.id) canvasIdMap.set(canvas.id, newCanvasIds[index]);
                const nodeMap = new Map((canvas.nodes || []).map((node) => [node.id, nanoid()]));
                if (canvas.id) canvasNodeMaps.set(canvas.id, nodeMap);
                nodeMap.forEach((newId, oldId) => nodeIdMap.set(oldId, newId));
                return nodeMap;
            });
            const assetIdMap = new Map((source.assets || []).map((asset) => [asset.id, nanoid()]));
            const canvases = sourceCanvases.map((canvas, index) => {
                const nodeMap = nodeMaps[index];
                const chatIdMap = new Map((canvas.chatSessions || []).map((session) => [session.id, nanoid()]));
                const nodes: CanvasNodeData[] = (canvas.nodes || []).map((node) => ({
                    ...node,
                    id: requiredImportedId(nodeMap, node.id, "节点"),
                    metadata: remapImportedMetadata(node.metadata, nodeMap, assetIdMap, storageKeyMap),
                }));
                const chatSessions = (canvas.chatSessions || []).map((session) => ({
                    ...session,
                    id: requiredImportedId(chatIdMap, session.id, "会话"),
                    messages: session.messages.map((message) => ({
                        ...message,
                        id: nanoid(),
                        references: message.references?.map((reference) => ({
                            ...reference,
                            id: requiredImportedId(nodeMap, reference.id, "会话参考节点"),
                            storageKey: remapImportedMediaValue(reference.storageKey, storageKeyMap),
                            dataUrl: remapImportedMediaValue(reference.dataUrl, storageKeyMap),
                        })),
                    })),
                }));
                return makeCanvas(project.id, canvas.title || i18n.t("canvas.documents.defaultTitleWithIndex", { index: index + 1 }), newCanvasIds[index], {
                    ...canvas,
                    nodes,
                    connections: (canvas.connections || []).map((connection) => ({
                        ...connection,
                        id: nanoid(),
                        fromNodeId: requiredImportedId(nodeMap, connection.fromNodeId, "连线起点节点"),
                        toNodeId: requiredImportedId(nodeMap, connection.toNodeId, "连线终点节点"),
                    })),
                    chatSessions,
                    activeChatId: canvas.activeChatId ? requiredImportedId(chatIdMap, canvas.activeChatId, "活跃会话") : null,
                });
            });
            project.activeCanvasId = source.activeCanvasId ? requiredImportedId(canvasIdMap, source.activeCanvasId, "活跃画布") : canvases[0].id;
            const assets = (source.assets || []).map((asset) => remapImportedAsset(asset, project.id, source.id, assetIdMap, canvasIdMap, canvasNodeMaps, nodeIdMap, storageKeyMap));
            const stored = await createStoredProject(project, canvases, assets);
            set((state) => ({ projects: upsertSummary(state.projects, stored.project, stored.canvases.map(canvasSummary), assets.length), storageError: null }));
            return stored.project.id;
        },
        openProject: async (id, canvasId) => {
            const current = get();
            if (current.activeProject?.id === id && current.activeCanvas && (!canvasId || current.activeCanvas.id === canvasId)) {
                return { project: current.activeProject, canvases: current.canvases, canvas: current.activeCanvas };
            }
            await flushProject();
            let project = await readProject(id);
            if (!project) return null;
            let canvases = await listStoredCanvases(id);
            let selectedId = canvasId || project.activeCanvasId || canvases[0]?.id;
            let canvas = selectedId ? await readStoredCanvas(id, selectedId) : null;
            if (!canvas && canvases[0]) {
                selectedId = canvases[0].id;
                canvas = await readStoredCanvas(id, selectedId);
            }
            if (!canvas) {
                canvas = await createStoredCanvas(makeCanvas(id, i18n.t("canvas.documents.defaultTitle")));
                canvases = [canvasSummary(canvas)];
                selectedId = canvas.id;
            }
            if (project.activeCanvasId !== selectedId) project = await setActiveStoredCanvas(id, selectedId!);
            set({ activeProject: project, activeCanvas: canvas, canvases, storageError: null });
            return { project, canvases, canvas };
        },
        renameProject: async (id, title) => {
            await flushProject();
            const project = await renameStoredProject(id, title);
            set((state) => ({
                projects: state.projects.map((item) => (item.id === id ? { ...item, title: project.title, updatedAt: project.updatedAt, revision: project.revision } : item)),
                activeProject: state.activeProject?.id === id ? project : state.activeProject,
                storageError: null,
            }));
        },
        deleteProjects: async (ids) => {
            if (!ids.length) return;
            await flushProject();
            await deleteStoredProjects(ids);
            set((state) => ({
                projects: state.projects.filter((project) => !ids.includes(project.id)),
                activeProject: state.activeProject && ids.includes(state.activeProject.id) ? null : state.activeProject,
                activeCanvas: state.activeProject && ids.includes(state.activeProject.id) ? null : state.activeCanvas,
                canvases: state.activeProject && ids.includes(state.activeProject.id) ? [] : state.canvases,
                storageError: null,
            }));
        },
        replaceProjects: async (projects) => {
            await flushProject();
            await replaceStoredProjects(projects);
            set({ projects: await listProjects(), activeProject: null, activeCanvas: null, canvases: [], storageError: null });
        },
        createCanvas: async (projectId, title) => {
            const canvas = await createStoredCanvas(makeCanvas(projectId, title || i18n.t("canvas.documents.defaultTitleWithIndex", { index: get().canvases.length + 1 })));
            set((state) => {
                if (state.activeProject?.id !== projectId) return state;
                const canvases = [...state.canvases, canvasSummary(canvas)];
                return { canvases, projects: upsertSummary(state.projects, state.activeProject, canvases), storageError: null };
            });
            return canvas;
        },
        duplicateCanvas: async (projectId, canvasId) => {
            await flushCanvas(projectId, canvasId);
            const source = get().activeCanvas?.id === canvasId ? get().activeCanvas! : await readStoredCanvas(projectId, canvasId);
            if (!source) throw new Error("画布不存在");
            const canvas = makeCanvas(projectId, i18n.t("canvas.documents.copyTitle", { title: source.title }), nanoid(), source);
            const stored = await createStoredCanvas(canvas);
            set((state) => {
                if (state.activeProject?.id !== projectId) return state;
                const canvases = [...state.canvases, canvasSummary(stored)];
                return { canvases, projects: upsertSummary(state.projects, state.activeProject, canvases), storageError: null };
            });
            return stored;
        },
        renameCanvas: async (projectId, canvasId, title) => {
            await flushCanvas(projectId, canvasId);
            const canvas = await renameStoredCanvas(projectId, canvasId, title);
            set((state) => {
                if (state.activeProject?.id !== projectId) return state;
                const canvases = state.canvases.map((item) => (item.id === canvasId ? canvasSummary(canvas) : item));
                return {
                    activeCanvas: state.activeCanvas?.id === canvasId ? canvas : state.activeCanvas,
                    canvases,
                    projects: upsertSummary(state.projects, state.activeProject, canvases),
                    storageError: null,
                };
            });
        },
        deleteCanvas: async (projectId, canvasId) => {
            await flushCanvas(projectId, canvasId);
            const canvases = await deleteStoredCanvas(projectId, canvasId);
            const nextId = canvases[0]?.id || null;
            let project = get().activeProject;
            if (project?.id === projectId && project.activeCanvasId === canvasId && nextId) project = await setActiveStoredCanvas(projectId, nextId);
            set((state) => ({
                activeProject: project?.id === projectId ? project : state.activeProject,
                activeCanvas: state.activeCanvas?.id === canvasId ? null : state.activeCanvas,
                canvases: state.activeProject?.id === projectId ? canvases : state.canvases,
                projects: project?.id === projectId ? upsertSummary(state.projects, project, canvases) : state.projects,
                storageError: null,
            }));
            return nextId;
        },
        setProjectAssetCount: (projectId, count) => set((state) => ({
            projects: state.projects.map((project) => (project.id === projectId ? { ...project, assetCount: count } : project)),
        })),
        updateCanvas: (projectId, canvasId, patch) => {
            if (get().activeProject?.id !== projectId || get().activeCanvas?.id !== canvasId) return;
            set((state) => {
                if (state.activeProject?.id !== projectId || state.activeCanvas?.id !== canvasId) return state;
                const now = new Date().toISOString();
                const key = canvasKey(projectId, canvasId);
                const revision = dirtyCanvases.get(key)?.revision ?? state.activeCanvas.revision;
                const activeCanvas = { ...state.activeCanvas, ...patch, revision, updatedAt: now };
                const activeProject = { ...state.activeProject, updatedAt: now };
                const canvases = state.canvases.map((item) => (item.id === canvasId ? canvasSummary(activeCanvas) : item));
                dirtyCanvases.set(key, activeCanvas);
                return { activeProject, activeCanvas, canvases, projects: upsertSummary(state.projects, activeProject, canvases) };
            });
            scheduleSave(projectId, canvasId);
        },
        flushProject,
    };
});

void listProjects()
    .then((projects) => useCanvasStore.setState({ projects, hydrated: true }))
    .catch((error) => useCanvasStore.setState({ hydrated: true, storageError: errorMessage(error) }));
