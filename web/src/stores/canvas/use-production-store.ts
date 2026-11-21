import { create } from "zustand";

import { readProject, updateStoredProject } from "@/services/project-storage";
import { createEmptyProduction, normalizeProduction } from "@/lib/production/production-model";
import type { ProductionState } from "@/types/canvas";

type ProductionStore = {
    projectId: string;
    data: ProductionState | null;
    loading: boolean;
    saving: boolean;
    error: string;
    load: (projectId: string, canvasId: string) => Promise<void>;
    update: (patch: Partial<ProductionState>) => void;
    flush: () => Promise<void>;
    reset: () => void;
};

const SAVE_DELAY = 400;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Promise<void> | null = null;

export const useProductionStore = create<ProductionStore>((set, get) => ({
    projectId: "",
    data: null,
    loading: false,
    saving: false,
    error: "",
    load: async (projectId, canvasId) => {
        const current = get();
        if (current.projectId === projectId && current.data) {
            if (canvasId && current.data.canvasId !== canvasId) set({ data: { ...current.data, canvasId } });
            return;
        }
        set({ projectId, loading: true, error: "" });
        try {
            const project = await readProject(projectId);
            if (!project) {
                set({ data: null, loading: false, error: "项目不存在" });
                return;
            }
            if (!project.production) {
                set({ data: createEmptyProduction(canvasId), loading: false });
                return;
            }
            set({ data: normalizeProduction(project.production, canvasId), loading: false });
        } catch (error) {
            set({ data: null, loading: false, error: error instanceof Error ? error.message : "生产数据读取失败" });
        }
    },
    update: (patch) => {
        const current = get().data;
        if (!current) return;
        const next: ProductionState = { ...current, ...patch, version: 1, updatedAt: new Date().toISOString() };
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
                await updateStoredProject(projectId, { production: data });
                set({ error: "" });
            } catch (error) {
                set({ error: error instanceof Error ? error.message : "生产数据保存失败" });
            } finally {
                set({ saving: false });
                pending = null;
            }
        })();
        await pending;
    },
    reset: () => set({ projectId: "", data: null, loading: false, saving: false, error: "" }),
}));
