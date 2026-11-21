import { create } from "zustand";

export type CanvasViewMode = "canvas" | "storyboard";

const MODE_KEY = "infinite-canvas:canvas-view-mode";

function initialMode(): CanvasViewMode {
    if (typeof window === "undefined") return "canvas";
    return localStorage.getItem(MODE_KEY) === "storyboard" ? "storyboard" : "canvas";
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
