import { create } from "zustand";

export type CanvasViewMode = "canvas";

type CanvasViewStore = {
    mode: CanvasViewMode;
    setMode: (mode: CanvasViewMode) => void;
};

/** 画布视图模式：生产工作台已改为右侧抽屉，画布始终可见。 */
export const useCanvasViewStore = create<CanvasViewStore>((set) => ({
    mode: "canvas",
    setMode: (mode) => set({ mode }),
}));
