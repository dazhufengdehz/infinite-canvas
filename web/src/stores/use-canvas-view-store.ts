import { create } from "zustand";

export type CanvasViewMode = "canvas" | "storyboard" | "assets";

const MODE_KEY = "infinite-canvas:canvas-view-mode";

function initialMode(): CanvasViewMode {
    if (typeof window === "undefined") return "canvas";
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "storyboard" || stored === "assets" ? stored : "canvas";
}

type CanvasViewStore = {
    mode: CanvasViewMode;
    setMode: (mode: CanvasViewMode) => void;
};

export const useCanvasViewStore = create<CanvasViewStore>((set) => ({
    mode: initialMode(),
    setMode: (mode) => {
        if (typeof window !== "undefined") localStorage.setItem(MODE_KEY, mode);
        set({ mode });
    },
}));
