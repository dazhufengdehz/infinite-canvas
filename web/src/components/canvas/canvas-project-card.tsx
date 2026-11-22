import { Check, Download, FolderOpen, Pencil, Trash2, X } from "lucide-react";
import { Input } from "antd";
import { useTranslation } from "react-i18next";

import { IconButton } from "@/components/ui/button";
import { useCanvasProjectActions } from "@/components/canvas/use-canvas-project-actions";
import { cn } from "@/lib/utils";
import type { CanvasProjectSummary } from "@/stores/canvas/use-canvas-store";

export function CanvasProjectCard({ project }: { project: CanvasProjectSummary }) {
    const { i18n, t } = useTranslation();
    const actions = useCanvasProjectActions(project);

    return (
        <article
            className={cn(
                "group flex min-h-44 cursor-pointer flex-col justify-between rounded-xl border border-hairline bg-surface p-5 transition-colors hover:bg-surface-hover",
                actions.selected && "border-hairline-strong bg-surface-active hover:bg-surface-active",
            )}
            onClick={() => !actions.editing && actions.open()}
        >
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={actions.selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => actions.toggleSelected(event.target.checked)}
                    className="mt-1 size-4 shrink-0 accent-action"
                    aria-label={t("canvas.project.select", { name: project.title })}
                />
                {actions.editing ? (
                    <Input className="min-w-0" value={actions.editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => actions.setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void actions.saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            actions.open();
                        }}
                    >
                        <span className="flex items-center gap-2">
                            <h2 className="truncate text-heading font-semibold text-ink">{project.title}</h2>
                            {project.migrateRequired ? <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-[11px] text-ink-soft">{t("canvas.project.migrateRequired")}</span> : null}
                        </span>
                        <p className="mt-3 text-meta leading-5 text-ink-soft">
                            {t("canvas.project.stats", { canvases: project.canvasCount, nodes: project.nodeCount, connections: project.connectionCount, assets: project.assetCount })}
                        </p>
                    </button>
                )}
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-meta text-ink-faint">
                    {t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}
                </p>
                <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
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
                                <IconButton size="sm" onClick={actions.open} aria-label={t("canvas.project.migrate")}>
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
        </article>
    );
}
