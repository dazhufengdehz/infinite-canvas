import { App } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { readProjectBundle } from "@/services/project-storage";
import { useCanvasStore, type CanvasProjectSummary } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

/** 项目库列表与卡片共用的项目操作。 */
export function useCanvasProjectActions(project: CanvasProjectSummary) {
    const { message } = App.useApp();
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

    const open = () => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}${agentHash}`, { replace: Boolean(agentHash) });
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
