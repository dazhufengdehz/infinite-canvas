import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Bot, Check, ChevronsUpDown, CircleUser, Copy, Download, FolderOpen, Home, Images, Menu, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Redo2, Save, Trash2, Undo2, Upload } from "lucide-react";
import { App, Dropdown, Input, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { CanvasComfyuiMonitor } from "./canvas-comfyui-monitor";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useCollabStore } from "@/stores/use-collab-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasViewStore } from "@/stores/use-canvas-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { DOCS_URL } from "@/constant/env";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onBack,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenAssetPicker,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onBack: () => void;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenAssetPicker?: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);
    const viewMode = useCanvasViewStore((state) => state.mode);
    const setViewMode = useCanvasViewStore((state) => state.setMode);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex justify-center p-3">
                <div
                    className="pointer-events-auto flex h-[46px] min-w-0 items-center gap-0.5 rounded-full border px-2 shadow-float backdrop-blur-xl"
                    style={{ background: theme.accent.chrome, borderColor: theme.hairline.base }}
                >
                    <Tooltip title={t("canvas.back")}>
                        <button
                            type="button"
                            onClick={onBack}
                            aria-label={t("canvas.back")}
                            className="grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                            style={{ color: theme.text.secondary }}
                        >
                            <ArrowLeft className="size-4" />
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "view-canvas", icon: <MenuCheck active={viewMode === "canvas"} />, label: t("canvas.view.canvas"), onClick: () => setViewMode("canvas") },
                                { key: "view-production", icon: <MenuCheck active={viewMode === "production"} />, label: t("canvas.view.production"), onClick: () => setViewMode("production") },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas.undo")} shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas.redo")} shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                                { type: "divider" },
                                { key: "home", icon: <Home className="size-4" />, label: t("canvas.home"), onClick: onHome },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: t("canvas.docs"), onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                                { key: "projects", icon: <Images className="size-4" />, label: t("canvas.projects"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.deleteCurrent"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "assets", icon: <FolderOpen className="size-4" />, label: t("canvas.assetPicker.title"), onClick: onOpenAssetPicker },
                                { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importAsset"), onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover" style={{ color: theme.text.secondary }} aria-label={t("topNav.openMenu")}>
                            <Menu className="size-4" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center px-1.5">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[260px] bg-transparent p-0 text-left text-body font-semibold outline-none"
                                style={{ color: theme.text.primary }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[260px] truncate border-b border-dashed border-transparent text-left text-body font-semibold transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title={t("canvas.renameHint")}
                            >
                                {title}
                            </button>
                        )}
                    </div>
                    <CanvasDocumentSwitcher />

                    <span className="mx-0.5 h-4 w-px shrink-0" style={{ background: theme.hairline.base }} />
                    <CanvasComfyuiMonitor />
                    <CompactAgentStatus status={compactAgentStatus} active={agentOpen} onClick={onToggleAgent} />
                    <CanvasSaveStatus />
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                            className="grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                            style={{ color: theme.text.secondary }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <AccountMenu onOpenPlugins={onOpenPlugins} onOpenShortcuts={() => setShortcutsOpen(true)} />
                </div>
            </div>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-body" style={{ borderColor: theme.hairline.base }}>
                    <Shortcut keys={["Ctrl / Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomSlider")]} value={t("canvas.shortcut.preciseZoom")} />
                    <Shortcut keys={[t("canvas.shortcut.drag")]} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                    <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
                    <Shortcut keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                </div>
            </Modal>
        </>
    );
}

function CanvasDocumentSwitcher() {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const params = useParams<{ id: string }>();
    const projectId = params.id || "";
    const canvases = useCanvasStore((state) => state.canvases);
    const activeCanvas = useCanvasStore((state) => state.activeCanvas);
    const createCanvas = useCanvasStore((state) => state.createCanvas);
    const duplicateCanvas = useCanvasStore((state) => state.duplicateCanvas);
    const renameCanvas = useCanvasStore((state) => state.renameCanvas);
    const deleteCanvas = useCanvasStore((state) => state.deleteCanvas);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];

    const openCanvas = (canvasId: string) => {
        if (!canvasId || canvasId === activeCanvas?.id) return;
        useCollabStore.getState().disconnect();
        navigate(`/canvas/${projectId}/${canvasId}`);
    };
    const run = (action: () => Promise<void>) => void action().catch((error) => message.error(error instanceof Error ? error.message : t("canvas.projectPage.notFound")));
    const rename = () => {
        if (!activeCanvas) return;
        let title = activeCanvas.title;
        modal.confirm({
            title: t("canvas.documents.rename"),
            content: <Input autoFocus defaultValue={title} onChange={(event) => (title = event.target.value)} />,
            onOk: async () => {
                if (title.trim()) await renameCanvas(projectId, activeCanvas.id, title.trim());
            },
        });
    };
    const remove = () => {
        if (!activeCanvas || canvases.length <= 1) return;
        modal.confirm({
            title: t("canvas.documents.deleteTitle"),
            content: t("canvas.documents.deleteDescription", { title: activeCanvas.title }),
            okButtonProps: { danger: true },
            onOk: async () => {
                const nextId = await deleteCanvas(projectId, activeCanvas.id);
                if (nextId) openCanvas(nextId);
            },
        });
    };

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: [
                    ...canvases.map((canvas) => ({
                        key: canvas.id,
                        label: canvas.title,
                        onClick: () => openCanvas(canvas.id),
                    })),
                    { type: "divider" as const },
                    { key: "create", icon: <Plus className="size-4" />, label: t("canvas.documents.create"), onClick: () => run(async () => openCanvas((await createCanvas(projectId)).id)) },
                    { key: "duplicate", disabled: !activeCanvas, icon: <Copy className="size-4" />, label: t("canvas.documents.duplicate"), onClick: () => run(async () => { if (activeCanvas) openCanvas((await duplicateCanvas(projectId, activeCanvas.id)).id); }) },
                    { key: "rename", disabled: !activeCanvas, icon: <Pencil className="size-4" />, label: t("canvas.documents.rename"), onClick: rename },
                    { key: "delete", disabled: !activeCanvas || canvases.length <= 1, danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.documents.delete"), onClick: remove },
                ],
            }}
        >
            <button type="button" className="flex h-8 max-w-44 items-center gap-1.5 rounded-control px-2 text-label transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover" style={{ color: theme.text.secondary }}>
                <span className="truncate">{activeCanvas?.title || t("canvas.documents.defaultTitle")}</span>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </button>
        </Dropdown>
    );
}

function CanvasSaveStatus() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const saving = useCanvasStore((state) => state.saving);
    const storageError = useCanvasStore((state) => state.storageError);
    const flushProject = useCanvasStore((state) => state.flushProject);
    const [manualSaving, setManualSaving] = useState(false);
    const busy = manualSaving || saving;

    const save = async () => {
        setManualSaving(true);
        try {
            await flushProject();
            const state = useCanvasStore.getState();
            if (state.storageError || state.hasPendingSaves()) throw new Error(state.storageError || t("canvas.saveStatus.failed"));
            message.success(t("canvas.saveStatus.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.saveStatus.failed"));
        } finally {
            setManualSaving(false);
        }
    };

    return (
        <div className="flex min-w-0 items-center gap-1">
            {storageError ? <span className="max-w-[180px] truncate text-meta font-medium" style={{ color: theme.state.danger }} title={storageError}>{t("canvas.saveStatus.failed")}</span> : null}
            <button
                type="button"
                onClick={() => void save()}
                disabled={manualSaving}
                className="flex h-8 shrink-0 items-center gap-1 rounded-control px-2 text-label transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover disabled:opacity-50"
                style={{ color: theme.text.secondary }}
            >
                <Save className="size-3.5" />
                <span>{busy ? t("canvas.saveStatus.saving") : t("canvas.saveStatus.save")}</span>
            </button>
        </div>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function MenuCheck({ active }: { active: boolean }) {
    return <Check className={`size-4 ${active ? "" : "opacity-0"}`} />;
}

function AccountMenu({ onOpenPlugins, onOpenShortcuts }: { onOpenPlugins: () => void; onOpenShortcuts: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            arrow={false}
            popupRender={() => (
                <div className="flex items-center gap-1 rounded-panel border p-1.5 shadow-float" style={{ background: theme.surface.base, borderColor: theme.hairline.base }}>
                    <UserStatusActions variant="canvas" showCredit={false} onOpenShortcuts={onOpenShortcuts} onOpenPlugins={onOpenPlugins} />
                </div>
            )}
        >
            <button
                type="button"
                aria-label={t("topNav.account")}
                title={t("topNav.account")}
                className="grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                style={{ color: theme.text.secondary }}
            >
                <CircleUser className="size-4.5" />
            </button>
        </Dropdown>
    );
}

function CompactAgentStatus({ status, active = false, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; active?: boolean; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const { t } = useTranslation();
    const label = status.connected ? t("canvas.agentConnected") : status.enabled ? t("canvas.agentConnecting", { activity: status.activity || t("canvas.connecting") }) : t("canvas.agentDisconnected");
    const dotColor = status.connected ? theme.state.success : status.enabled ? theme.state.warning : theme.text.tertiary;
    return (
        <Tooltip title={label}>
            <button
                type="button"
                className="relative grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[var(--motion-hover)] hover:bg-surface-hover"
                style={{ background: active ? theme.surface.active : undefined, color: active ? theme.text.primary : theme.text.secondary }}
                onClick={onClick}
                aria-label={t("canvas.openAgent")}
            >
                <Bot className="size-4" />
                <span className="absolute right-1 top-1 size-1.5 rounded-full" style={{ background: dotColor }} />
            </button>
        </Tooltip>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-control border px-2.5 py-1.5 text-center text-meta font-medium leading-none"
                            style={{ borderColor: "var(--hairline-base)", background: "var(--surface-sunken)", color: "var(--ink-secondary)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
