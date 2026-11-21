import type { ReactNode } from "react";
import { Compass, Focus, HelpCircle } from "lucide-react";
import { useState } from "react";
import { Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

/** 右下角缩放组：小地图开关、复位、缩放滑杆与快捷键。 */
export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const agentPanelWidth = useAgentStore((state) => state.width);
    const itemStyle = { color: theme.text.secondary };
    const activeStyle = { background: theme.surface.active, color: theme.text.primary };

    return (
        <div
            data-canvas-overlay
            className="absolute bottom-5 z-50 flex items-center gap-1"
            style={{ right: agentPanelOpen ? agentPanelWidth + 24 : 18 }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-control transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                    style={isMiniMapOpen ? activeStyle : itemStyle}
                    onClick={onToggleMiniMap}
                    aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                    aria-pressed={isMiniMapOpen}
                >
                    <Compass className="size-4" />
                </button>
            </Tooltip>
            <Tooltip title={t("canvas.resetView")}>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-control transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                    style={itemStyle}
                    onClick={onReset}
                    aria-label={t("canvas.resetView")}
                >
                    <Focus className="size-4" />
                </button>
            </Tooltip>
            <Tooltip title={t("canvas.zoom")}>
                <input
                    type="range"
                    min="5"
                    max="500"
                    step="1"
                    value={Math.round(scale * 100)}
                    className="mx-1 w-20"
                    style={{ accentColor: theme.accent.base }}
                    onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                    aria-label={t("canvas.zoom")}
                />
            </Tooltip>
            <span className="w-9 text-right text-meta tabular-nums" style={{ color: theme.text.tertiary }}>
                {Math.round(scale * 100)}%
            </span>
            <Tooltip title={t("canvas.shortcuts")}>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-control transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                    style={shortcutsOpen ? activeStyle : itemStyle}
                    onClick={() => setShortcutsOpen(true)}
                    aria-label={t("canvas.shortcuts")}
                >
                    <HelpCircle className="size-4" />
                </button>
            </Tooltip>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-body" style={{ borderColor: theme.hairline.base }}>
                    <Shortcut label={`Ctrl / Space + ${t("canvas.shortcut.drag")}`} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut label={t("canvas.shortcut.wheel")} value={t("canvas.shortcut.zoom")} />
                    <Shortcut label={t("canvas.shortcut.drag")} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut label={`Shift / Cmd + ${t("canvas.shortcut.click")}`} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut label="Ctrl / Cmd + C / V" value={t("canvas.shortcut.copyPasteNodes")} />
                    <Shortcut label="Delete / Backspace" value={t("canvas.shortcut.delete")} />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="font-medium" style={{ color: "var(--ink-primary)" }}>
                {label}
            </span>
            <span style={{ color: "var(--ink-tertiary)" }}>{value}</span>
        </div>
    );
}
