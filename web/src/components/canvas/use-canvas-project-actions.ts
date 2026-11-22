import { App } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { migrateStoredProject, readProjectBundle } from "@/services/project-storage";
import { isDesktopRuntime } from "@/services/api/storage";
import { readLastProjectDir, rememberProjectDir } from "@/lib/canvas/project-location";
import { useCanvasStore, type CanvasProjectSummary } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

/** 项目库列表与卡片共用的项目操作。 */
export function useCanvasProjectActions(project: CanvasProjectSummary) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const refreshProjects = useCanvasStore((state) => state.refreshProjects);

    const navigateToProject = () => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}${agentHash}`, { replace: Boolean(agentHash) });
    };

    const open = async () => {
        if (project.migrateRequired) {
            if (!isDesktopRuntime()) {
                message.error(t("canvas.migrateDesktopOnly"));
                return;
            }
            try {
                const { open: pickFolder } = await import("@tauri-apps/plugin-dialog");
                const targetParent = await pickFolder({ directory: true, multiple: false, title: t("canvas.migrateChooseFolder"), defaultPath: readLastProjectDir() });
                if (typeof targetParent !== "string") return;
                const confirmed = await new Promise<boolean>((resolve) => {
                    modal.confirm({
                        title: t("canvas.migrateTitle"),
                        content: t("canvas.migrateDescription", { from: project.legacyPath || "", to: targetParent }),
                        okText: t("canvas.migrateStart"),
                        cancelText: t("common.cancel"),
                        onOk: () => resolve(true),
                        onCancel: () => resolve(false),
                    });
                });
                if (!confirmed) return;
                const loadingKey = `migrate-${project.id}`;
                message.open({ key: loadingKey, type: "loading", content: t("canvas.migrating"), duration: 0 });
                try {
                    await migrateStoredProject(project.id, targetParent);
                    rememberProjectDir(targetParent);
                    await refreshProjects();
                } finally {
                    message.destroy(loadingKey);
                }
                message.success(t("canvas.migrateSuccess"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.migrateFailed"));
                return;
            }
        }
        navigateToProject();
    };
    const saveTitle = async () => {
        try {
            await renameProject(project.id, editingTitle);
            stopEditing();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.project.rename"));
        }
    };
    const exportProject = async () => {
        try {
            const stored = await readProjectBundle(project.id);
            if (stored) await exportCanvasProjects([stored], project.title || t("canvas.title"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.project.export"));
        }
    };

    return {
        editing: editingId === project.id,
        selected: selectedIds.includes(project.id),
        editingTitle,
        open,
        saveTitle,
        setEditingTitle,
        exportProject,
        startEditing: () => startEditing(project.id, project.title),
        stopEditing,
        toggleSelected: (checked: boolean) => toggleSelected(project.id, checked),
        requestDelete: () => setDeleteIds([project.id]),
    };
}
