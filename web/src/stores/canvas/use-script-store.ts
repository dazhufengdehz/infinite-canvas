import { create } from "zustand";

import { readProject, updateStoredProject } from "@/services/project-storage";
import { createEmptyScriptState } from "@/lib/canvas/script-model";
import type { CanvasScriptOptions, CanvasScriptState } from "@/types/canvas";

type ScriptStore = {
    projectId: string;
    data: CanvasScriptState | null;
    loading: boolean;
    saving: boolean;
    error: string;
    load: (projectId: string) => Promise<void>;
    update: (patch: Partial<CanvasScriptState>) => void;
    flush: () => Promise<void>;
    reset: () => void;
};

const SAVE_DELAY = 400;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Promise<void> | null = null;

export const useScriptStore = create<ScriptStore>((set, get) => ({
    projectId: "",
    data: null,
    loading: false,
    saving: false,
    error: "",
    load: async (projectId) => {
        if (get().projectId === projectId && get().data) return;
        set({ projectId, loading: true, error: "" });
        try {
            const project = await readProject(projectId);
            if (!project?.script) {
                set({ data: createEmptyScriptState(), loading: false });
                return;
            }
            if (project.script.version !== 2) {
                set({ data: null, loading: false, error: "剧本数据版本不兼容，请从项目备份恢复" });
                return;
            }
            set({ data: project.script, loading: false });
        } catch (error) {
            set({ data: null, loading: false, error: error instanceof Error ? error.message : "剧本数据读取失败" });
        }
    },
    update: (patch) => {
        const current = get().data;
        if (!current) return;
        const next = { ...current, ...patch, version: 2 as const, updatedAt: new Date().toISOString() };
        set({ data: next });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void get().flush(), SAVE_DELAY);
    },
    flush: async () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (pending) await pending;
        const { projectId, data } = get();
        if (!projectId || !data) return;
        set({ saving: true });
        pending = (async () => {
            try {
                await updateStoredProject(projectId, { script: data });
                set({ error: "" });
            } catch (error) {
                set({ error: error instanceof Error ? error.message : "剧本保存失败" });
            } finally {
                set({ saving: false });
                pending = null;
            }
        })();
        await pending;
    },
    reset: () => set({ projectId: "", data: null, loading: false, saving: false, error: "" }),
}));

export function emptyScriptState(options?: CanvasScriptOptions) {
    return createEmptyScriptState(options);
}
