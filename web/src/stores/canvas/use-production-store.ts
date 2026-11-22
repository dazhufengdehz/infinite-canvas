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
    dirty: boolean;
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
    dirty: false,
    // 打开项目时必须从磁盘重读，内存只作为渲染缓存；只有未保存的编辑才先落盘。
    load: async (projectId, canvasId) => {
        if (get().projectId === projectId && get().dirty) await get().flush();
        set({ projectId, loading: true, error: "" });
        try {
            const project = await readProject(projectId);
            if (!project) {
                set({ data: null, loading: false, error: "项目不存在", dirty: false });
                return;
            }
            if (!project.production) {
                set({ data: createEmptyProduction(canvasId), loading: false, dirty: false });
                return;
            }
            set({ data: normalizeProduction(project.production, canvasId), loading: false, dirty: false });
        } catch (error) {
            set({ data: null, loading: false, error: error instanceof Error ? error.message : "生产数据读取失败" });
        }
    },
    update: (patch) => {
        const current = get().data;
        if (!current) return;
        const next: ProductionState = { ...current, ...patch, version: 1, updatedAt: new Date().toISOString() };
        set({ data: next, dirty: true });
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void get().flush(), SAVE_DELAY);
    },
    flush: async () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (pending) await pending;
        const { projectId, data, dirty } = get();
        if (!projectId || !data || !dirty) return;
        set({ saving: true });
        pending = (async () => {
            let lastError: unknown;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await updateStoredProject(projectId, { production: data });
                    set(get().data === data ? { error: "", dirty: false } : { error: "" });
                    lastError = undefined;
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, [300, 1000][attempt]));
                }
            }
            if (lastError) set({ error: lastError instanceof Error ? lastError.message : "生产数据保存失败" });
            set({ saving: false });
            pending = null;
        })();
        await pending;
    },
    reset: () => set({ projectId: "", data: null, loading: false, saving: false, error: "", dirty: false }),
}));
