import { create } from "zustand";

export const PRODUCTION_PANEL_MOTION_MS = 420;
export const PRODUCTION_PANEL_MIN_WIDTH = 360;
export const PRODUCTION_PANEL_MAX_WIDTH = 720;
export const PRODUCTION_PANEL_DEFAULT_WIDTH = 480;

const WIDTH_KEY = "production-panel-width";
const OPEN_KEY = "production-panel-open";

function initialWidth() {
    if (typeof window === "undefined") return PRODUCTION_PANEL_DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (!stored) return PRODUCTION_PANEL_DEFAULT_WIDTH;
    return Math.min(PRODUCTION_PANEL_MAX_WIDTH, Math.max(PRODUCTION_PANEL_MIN_WIDTH, stored));
}

function initialOpen() {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(OPEN_KEY) === "1";
}

type ProductionPanelStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    setWidth: (width: number) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useProductionPanelStore = create<ProductionPanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initialOpen(),
    panelMounted: initialOpen(),
    panelClosing: false,
    setWidth: (width) => set({ width }),
    openPanel: () => {
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, PRODUCTION_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
