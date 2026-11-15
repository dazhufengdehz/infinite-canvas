import { create } from "zustand";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import {
    createStoredProject,
    deleteStoredProjects,
    listProjects,
    projectSummary,
    readProject,
    renameStoredProject,
    replaceStoredProjects,
    saveStoredProject,
} from "@/services/project-storage";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision?: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasProjectSummary = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodeCount: number;
    connectionCount: number;
};

type CanvasProjectPatch = Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>;

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProjectSummary[];
    activeProject: CanvasProject | null;
    storageError: string | null;
    createProject: (title?: string, id?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>, id?: string) => Promise<string>;
    openProject: (id: string) => Promise<CanvasProject | null>;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[]) => Promise<void>;
    updateProject: (id: string, patch: CanvasProjectPatch) => void;
    flushProject: () => Promise<void>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedProjectId: string | null = null;
let saveQueue: Promise<void> = Promise.resolve();

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "项目存储失败";
}

function upsertSummary(projects: CanvasProjectSummary[], project: CanvasProject) {
    const summary = projectSummary(project);
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
        nodes: source.nodes || [],
        connections: source.connections || [],
        chatSessions: source.chatSessions || [],
        activeChatId: source.activeChatId || null,
        backgroundMode: source.backgroundMode || "lines",
        showImageInfo: source.showImageInfo || false,
        viewport: source.viewport || initialViewport,
    };
}

async function persistProject(id: string) {
    const project = useCanvasStore.getState().activeProject;
    if (!project || project.id !== id) return;
    try {
        const saved = await saveStoredProject(project, project.revision || 1);
        useCanvasStore.setState((state) => {
            if (state.activeProject?.id !== id) return { projects: upsertSummary(state.projects, saved), storageError: null };
            const current = { ...state.activeProject, revision: saved.revision };
            return { activeProject: current, projects: upsertSummary(state.projects, current), storageError: null };
        });
    } catch (error) {
        useCanvasStore.setState({ storageError: errorMessage(error) });
    }
}

function enqueueSave(id: string) {
    saveQueue = saveQueue.then(() => persistProject(id));
    return saveQueue;
}

export const useCanvasStore = create<CanvasStore>()((set, get) => {
    const flushProject = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        const id = queuedProjectId;
        queuedProjectId = null;
        return id ? enqueueSave(id) : saveQueue;
    };

    const scheduleSave = (id: string) => {
        queuedProjectId = id;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            queuedProjectId = null;
            void enqueueSave(id);
        }, 400);
    };

    return {
        hydrated: false,
        projects: [],
        activeProject: null,
        storageError: null,
        createProject: async (title = i18n.t("canvas.project.untitled"), id) => {
            const project = makeProject(title, id);
            const stored = await createStoredProject(project);
            set((state) => ({ projects: upsertSummary(state.projects, stored), storageError: null }));
            return stored.id;
        },
        importProject: async (source, id) => {
            const project = makeProject(source.title || i18n.t("canvas.project.imported"), id, source);
            const stored = await createStoredProject(project);
            set((state) => ({ projects: upsertSummary(state.projects, stored), storageError: null }));
            return stored.id;
        },
        openProject: async (id) => {
            if (get().activeProject?.id === id) return get().activeProject;
            await flushProject();
            const project = await readProject(id);
            set({ activeProject: project, storageError: null });
            return project;
        },
        renameProject: async (id, title) => {
            await flushProject();
            const summary = await renameStoredProject(id, title);
            set((state) => ({
                projects: state.projects.map((item) => (item.id === id ? summary : item)),
                activeProject: state.activeProject?.id === id ? { ...state.activeProject, title: summary.title, updatedAt: summary.updatedAt, revision: summary.revision } : state.activeProject,
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
                storageError: null,
            }));
        },
        replaceProjects: async (projects) => {
            await flushProject();
            await replaceStoredProjects(projects);
            set({ projects: await listProjects(), activeProject: null, storageError: null });
        },
        updateProject: (id, patch) => {
            if (get().activeProject?.id !== id) return;
            set((state) => {
                if (state.activeProject?.id !== id) return state;
                const activeProject = { ...state.activeProject, ...patch, updatedAt: new Date().toISOString() };
                return { activeProject, projects: upsertSummary(state.projects, activeProject) };
            });
            scheduleSave(id);
        },
        flushProject,
    };
});

void listProjects()
    .then((projects) => useCanvasStore.setState({ projects, hydrated: true }))
    .catch((error) => useCanvasStore.setState({ hydrated: true, storageError: errorMessage(error) }));
