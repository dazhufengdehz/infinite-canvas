import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Dropdown, Input, Modal } from "antd";
import { ArrowUpDown, Download, FileUp, FolderOpen, LayoutGrid, List, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { checkStoredProjectFolder, readProjects, readStoredMigrations, registerStoredProjectLocation, rollbackStoredMigration, scopedStorageKey } from "@/services/project-storage";
import { isDesktopRuntime } from "@/services/api/storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { CanvasProjectRow } from "@/components/canvas/canvas-project-row";
import { Button, IconButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { collectStorageKeys, exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { readLastProjectDir, rememberProjectDir } from "@/lib/canvas/project-location";

type LibraryFilter = "all" | "recent" | "empty";
type LibrarySort = "updated" | "name";
type LibraryView = "list" | "grid";

const RECENT_WINDOW = 7 * 24 * 60 * 60 * 1000;

export default function CanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const refreshProjects = useCanvasStore((state) => state.refreshProjects);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<LibraryFilter>("all");
    const [sort, setSort] = useState<LibrarySort>("updated");
    const [view, setView] = useState<LibraryView>("list");
    const [createOpen, setCreateOpen] = useState(false);
    const [createTitle, setCreateTitle] = useState("");
    const [createPath, setCreatePath] = useState("");
    const [creating, setCreating] = useState(false);
    const isDesktop = "__TAURI_INTERNALS__" in window;

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const keyword = query.trim().toLowerCase();
    const visibleProjects = projects
        .filter((project) => {
            if (filter === "empty") return project.nodeCount === 0;
            if (filter === "recent") return Date.now() - Date.parse(project.updatedAt) <= RECENT_WINDOW;
            return true;
        })
        .filter((project) => !keyword || project.title.toLowerCase().includes(keyword))
        .sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const openCreateDialog = () => {
        setCreateTitle(t("canvas.defaultTitle", { count: projects.length + 1 }));
        setCreatePath("");
        setCreateOpen(true);
        const lastDir = isDesktop ? readLastProjectDir() : undefined;
        if (!lastDir) return;
        void checkStoredProjectFolder(lastDir)
            .then((status) => {
                if (!status.occupied) setCreatePath(lastDir);
            })
            .catch(() => {});
    };
    const chooseFolder = async () => {
        try {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({ directory: true, multiple: false, title: t("canvas.chooseFolder"), defaultPath: readLastProjectDir() });
            if (typeof selected !== "string") return;
            rememberProjectDir(selected);
            const status = await checkStoredProjectFolder(selected);
            if (status.occupied) {
                message.error(t("canvas.folderOccupied"));
                return;
            }
            if (!status.empty) {
                modal.confirm({
                    title: t("canvas.folderNotEmptyTitle"),
                    content: t("canvas.folderNotEmptyDescription"),
                    okText: t("common.confirm"),
                    cancelText: t("common.cancel"),
                    onOk: () => setCreatePath(selected),
                });
                return;
            }
            setCreatePath(selected);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        }
    };
    const submitCreate = async () => {
        if (creating) return;
        if (isDesktop && !createPath.trim()) {
            message.error(t("canvas.storagePathRequired"));
            return;
        }
        setCreating(true);
        try {
            const id = await createProject(createTitle.trim() || t("canvas.defaultTitle", { count: projects.length + 1 }), undefined, createPath || undefined);
            if (createPath) rememberProjectDir(createPath);
            setCreateOpen(false);
            enterProject(id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        } finally {
            setCreating(false);
        }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            let parentPath: string | undefined;
            if (isDesktop) {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({ directory: true, multiple: false, title: t("canvas.chooseFolder"), defaultPath: readLastProjectDir() });
                if (typeof selected !== "string") return;
                parentPath = selected;
                rememberProjectDir(selected);
            }
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            for (const exported of data.projects) {
                const id = nanoid();
                const folderTitle = String(exported.project.title || "project").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
                const storagePath = parentPath ? await (await import("@tauri-apps/api/path")).join(parentPath, `${folderTitle}-${id}`) : undefined;
                if (storagePath) await registerStoredProjectLocation(id, storagePath);
                const referencedKeys = collectStorageKeys(exported.project);
                const filesByKey = new Map(exported.files.map((file) => [file.storageKey, file]));
                const keyMap = new Map(referencedKeys.map((storageKey) => [storageKey, scopedStorageKey(storageKey.split(":", 1)[0], id)]));
                const files = referencedKeys.map((storageKey) => {
                    const file = filesByKey.get(storageKey);
                    const blob = file ? zip.get(file.path) : null;
                    if (!file || !blob) throw new Error(`Missing import media: ${storageKey}`);
                    return { file, blob, storageKey: keyMap.get(storageKey)! };
                });
                for (const { file, blob, storageKey } of files) {
                    const typedBlob = blob.type ? blob : blob.slice(0, blob.size, file.mimeType);
                    await (storageKey.startsWith("image:") ? setImageBlob(storageKey, typedBlob) : setMediaBlob(storageKey, typedBlob));
                }
                await importProject(exported.project, id, keyMap, storagePath);
            }
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    const exportSelected = () => {
        void readProjects(selectedIds)
            .then((stored) => exportCanvasProjects(stored, `${t("canvas.title")}-${selectedIds.length}`))
            .catch((error) => message.error(error instanceof Error ? error.message : t("canvas.importFailed")));
    };
    const exportAll = () => {
        void readProjects()
            .then((stored) => exportCanvasProjects(stored, `${t("canvas.title")}-${stored.length}`))
            .catch((error) => message.error(error instanceof Error ? error.message : t("canvas.importFailed")));
    };

    const rollbackLatestMigration = () => {
        void (async () => {
            try {
                const migrations = await readStoredMigrations();
                const record = [...migrations].reverse().find((item) => item.status === "done");
                if (!record) {
                    message.info(t("canvas.noMigration"));
                    return;
                }
                modal.confirm({
                    title: t("canvas.rollbackTitle"),
                    content: t("canvas.rollbackDescription", { from: record.to, to: record.from }),
                    okText: t("canvas.rollbackConfirm"),
                    cancelText: t("common.cancel"),
                    onOk: async () => {
                        await rollbackStoredMigration(record.projectId);
                        await refreshProjects();
                        message.success(t("canvas.rollbackSuccess"));
                    },
                });
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
            }
        })();
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        void (async () => {
            if (mode === "recent" && projects[0]) {
                if (projects[0].migrateRequired) {
                    navigate("/canvas", { replace: true });
                    return;
                }
                enterProject(projects[0].id);
                return;
            }
            const parent = isDesktop ? readLastProjectDir() : undefined;
            if (isDesktop && !parent) {
                autoOpenRef.current = false;
                openCreateDialog();
                return;
            }
            const title = t("canvas.defaultTitle", { count: projects.length + 1 });
            const id = nanoid();
            const folderName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
            const storagePath = parent ? await (await import("@tauri-apps/api/path")).join(parent, `${folderName}-${id}`) : undefined;
            const createdId = await createProject(title, id, storagePath);
            enterProject(createdId);
        })().catch((error) => {
            autoOpenRef.current = false;
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        });
    }, [createProject, hydrated, message, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent") && !createOpen) return <main className="flex h-full items-center justify-center bg-background text-body text-ink-faint">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background">
            <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-8 py-10">
                <PageHeader
                    eyebrow={t("canvas.library")}
                    title={t("canvas.title")}
                    description={t("canvas.libraryDescription")}
                    actions={
                        <>
                            <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                                {t("canvas.import")}
                            </Button>
                            <Button disabled={!hydrated} variant="primary" icon={<Plus className="size-4" />} onClick={openCreateDialog}>
                                {t("canvas.create")}
                            </Button>
                        </>
                    }
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            allowClear
                            prefix={<Search className="size-4 text-ink-faint" />}
                            placeholder={t("canvas.libraryTools.search")}
                            className="w-full sm:w-60"
                        />
                        <div className="flex items-center gap-1">
                            {(["all", "recent", "empty"] as const).map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => setFilter(item)}
                                    className={cn(
                                        "h-7 rounded-control px-2.5 text-label transition-colors duration-[var(--motion-hover)]",
                                        filter === item ? "bg-surface-active text-ink" : "text-ink-faint hover:bg-surface-hover hover:text-ink",
                                    )}
                                >
                                    {t(`canvas.libraryTools.filter.${item}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                selectable: true,
                                selectedKeys: [sort],
                                items: [
                                    { key: "updated", label: t("canvas.libraryTools.sort.updated") },
                                    { key: "name", label: t("canvas.libraryTools.sort.name") },
                                ],
                                onClick: ({ key }) => setSort(key as LibrarySort),
                            }}
                        >
                            <Button variant="ghost" size="sm" icon={<ArrowUpDown className="size-3.5" />} aria-label={t("canvas.libraryTools.sortLabel")}>
                                {t(`canvas.libraryTools.sort.${sort}`)}
                            </Button>
                        </Dropdown>
                        <IconButton className={cn(view === "list" && "bg-surface-active text-ink")} onClick={() => setView("list")} aria-label={t("canvas.libraryTools.view.list")} aria-pressed={view === "list"}>
                            <List />
                        </IconButton>
                        <IconButton className={cn(view === "grid" && "bg-surface-active text-ink")} onClick={() => setView("grid")} aria-label={t("canvas.libraryTools.view.grid")} aria-pressed={view === "grid"}>
                            <LayoutGrid />
                        </IconButton>
                        {projects.length ? (
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportAll") },
                                        ...(isDesktop ? [{ key: "rollback", label: t("canvas.rollbackMigration") }] : []),
                                        { type: "divider" },
                                        { key: "delete", icon: <Trash2 className="size-4" />, label: t("canvas.deleteAll"), danger: true },
                                    ],
                                    onClick: ({ key }) => {
                                        if (key === "export") return exportAll();
                                        if (key === "rollback") return rollbackLatestMigration();
                                        setDeleteIds(projects.map((project) => project.id));
                                    },
                                }}
                            >
                                <IconButton aria-label={t("canvas.libraryTools.more")}>
                                    <MoreHorizontal />
                                </IconButton>
                            </Dropdown>
                        ) : null}
                    </div>
                </div>

                {selectedIds.length ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-panel bg-surface-sunken px-4 py-2">
                        <span className="text-label text-ink">{t("canvas.libraryTools.selected", { count: selectedIds.length })}</span>
                        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={exportSelected}>
                            {t("canvas.exportSelected")}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-danger hover:text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleteIds(selectedIds)}>
                            {t("canvas.deleteSelected")}
                        </Button>
                        <Button size="sm" variant="ghost" className="ml-auto text-ink-faint" onClick={() => removeSelectedIds(selectedIds)}>
                            {t("canvas.libraryTools.clear")}
                        </Button>
                    </div>
                ) : null}

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-hairline text-body text-ink-faint">{t("canvas.loading")}</section>
                ) : !projects.length ? (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-hairline text-center">
                        <h2 className="text-title font-semibold text-ink">{t("canvas.empty")}</h2>
                        <p className="mt-2 text-body text-ink-soft">{t("canvas.emptyDescription")}</p>
                        <Button className="mt-6" variant="primary" icon={<Plus className="size-4" />} onClick={openCreateDialog}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                ) : !visibleProjects.length ? (
                    <section className="flex min-h-[240px] items-center justify-center border-y border-hairline text-body text-ink-faint">{t("canvas.libraryTools.noMatch")}</section>
                ) : view === "list" ? (
                    <section className="overflow-hidden rounded-panel border border-hairline bg-surface">
                        <div className="flex items-center gap-4 border-b border-hairline px-4 py-2.5 text-meta text-ink-faint">
                            <span className="size-4 shrink-0" />
                            <span className="flex-1">{t("canvas.libraryTools.columns.name")}</span>
                            <span className="hidden w-14 text-right md:block">{t("canvas.libraryTools.columns.canvas")}</span>
                            <span className="hidden w-14 text-right md:block">{t("canvas.libraryTools.columns.node")}</span>
                            <span className="hidden w-14 text-right md:block">{t("canvas.libraryTools.columns.asset")}</span>
                            <span className="hidden w-26 text-right md:block">{t("canvas.libraryTools.columns.updated")}</span>
                            <span className="w-22 shrink-0" />
                        </div>
                        <div className="divide-y divide-hairline">
                            {visibleProjects.map((project) => (
                                <CanvasProjectRow key={project.id} project={project} />
                            ))}
                        </div>
                    </section>
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {visibleProjects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                )}

                {hydrated && projects.length ? <p className="text-right text-meta text-ink-faint tabular-nums">{t("canvas.libraryTools.total", { count: projects.length })}</p> : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
            <Modal
                open={createOpen}
                title={t("canvas.create")}
                okText={t("canvas.create")}
                cancelText={t("common.cancel")}
                confirmLoading={creating}
                onOk={() => void submitCreate()}
                onCancel={() => setCreateOpen(false)}
            >
                <div className="space-y-5 pt-2">
                    <label className="block text-body">
                        <span className="mb-1 block text-ink-soft">{t("canvas.projectName")}</span>
                        <Input value={createTitle} placeholder={t("canvas.defaultTitle", { count: projects.length + 1 })} onChange={(event) => setCreateTitle(event.target.value)} onPressEnter={() => void submitCreate()} />
                    </label>
                    {isDesktop ? (
                        <div className="text-body">
                            <span className="mb-1 block text-ink-soft">{t("canvas.storagePath")}</span>
                            <div className="flex items-center gap-2">
                                <Input value={createPath} placeholder={t("canvas.storagePathPlaceholder")} readOnly />
                                <Button icon={<FolderOpen className="size-4" />} onClick={() => void chooseFolder()}>
                                    {t("canvas.chooseFolder")}
                                </Button>
                            </div>
                            <p className="mt-2 text-meta text-ink-faint">{t("canvas.storagePathHint")}</p>
                        </div>
                    ) : null}
                </div>
            </Modal>
        </main>
    );
}
