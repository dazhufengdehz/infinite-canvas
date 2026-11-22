import { Check, Download, FolderOpen, Pencil, Trash2, X } from "lucide-react";
import { Input } from "antd";
import { useTranslation } from "react-i18next";

import { IconButton } from "@/components/ui/button";
import { useCanvasProjectActions } from "@/components/canvas/use-canvas-project-actions";
import { cn } from "@/lib/utils";
import type { CanvasProjectSummary } from "@/stores/canvas/use-canvas-store";

/** 项目库列表行，列宽与列表表头保持一致。 */
export function CanvasProjectRow({ project }: { project: CanvasProjectSummary }) {
    const { i18n, t } = useTranslation();
    const actions = useCanvasProjectActions(project);

    return (
        <div
            className={cn("group flex min-h-[73px] cursor-pointer items-center gap-4 px-4 transition-colors hover:bg-surface-hover", actions.selected && "bg-surface-active hover:bg-surface-active")}
            onClick={() => !actions.editing && actions.open()}
        >
            <input
                type="checkbox"
                checked={actions.selected}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => actions.toggleSelected(event.target.checked)}
                className="size-4 shrink-0 accent-action"
                aria-label={t("canvas.project.select", { name: project.title })}
            />
            <div className="min-w-0 flex-1">
                {actions.editing ? (
                    <Input
                        value={actions.editingTitle}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => actions.setEditingTitle(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && void actions.saveTitle()}
                        autoFocus
                    />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left outline-none focus-visible:underline"
                        onClick={(event) => {
                            event.stopPropagation();
                            actions.open();
                        }}
                    >
                        <span className="flex items-center gap-2">
                            <span className="truncate text-heading font-semibold text-ink">{project.title}</span>
                            {project.migrateRequired ? <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-[11px] text-ink-soft">{t("canvas.project.migrateRequired")}</span> : null}
                        </span>
                        <span className="mt-1 block truncate text-meta text-ink-faint md:hidden">
                            {t("canvas.project.stats", { canvases: project.canvasCount, nodes: project.nodeCount, connections: project.connectionCount, assets: project.assetCount })}
                        </span>
                    </button>
                )}
            </div>
            <span className="hidden w-14 shrink-0 text-right text-meta text-ink-soft tabular-nums md:block">{project.canvasCount}</span>
            <span className="hidden w-14 shrink-0 text-right text-meta text-ink-soft tabular-nums md:block">{project.nodeCount}</span>
            <span className="hidden w-14 shrink-0 text-right text-meta text-ink-soft tabular-nums md:block">{project.assetCount}</span>
            <span className="hidden w-26 shrink-0 text-right text-meta text-ink-faint tabular-nums md:block">
                {new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
            <div className="flex w-22 shrink-0 items-center justify-end gap-0.5 md:opacity-50 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
                {actions.editing ? (
                    <>
                        <IconButton size="sm" onClick={() => void actions.saveTitle()} aria-label={t("canvas.project.saveName")}>
                            <Check />
                        </IconButton>
                        <IconButton size="sm" onClick={actions.stopEditing} aria-label={t("canvas.project.cancelRename")}>
                            <X />
                        </IconButton>
                    </>
                ) : (
                    <>
                        {project.migrateRequired ? (
                            <IconButton size="sm" onClick={() => void actions.open()} aria-label={t("canvas.project.migrate")}>
                                <FolderOpen />
                            </IconButton>
                        ) : null}
                        <IconButton size="sm" onClick={() => void actions.exportProject()} aria-label={t("canvas.project.export")}>
                            <Download />
                        </IconButton>
                        <IconButton size="sm" onClick={actions.startEditing} aria-label={t("canvas.project.rename")}>
                            <Pencil />
                        </IconButton>
                        <IconButton size="sm" className="hover:text-danger" onClick={actions.requestDelete} aria-label={t("canvas.project.delete")}>
                            <Trash2 />
                        </IconButton>
                    </>
                )}
            </div>
        </div>
    );
}
