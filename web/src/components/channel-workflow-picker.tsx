import { Select } from "antd";
import { useEffect, useMemo } from "react";
import { Server, Workflow } from "lucide-react";

import {
    getChannelWorkflows,
    getDefaultWorkflow,
    useConfigStore,
    useEffectiveConfig,
    type WorkflowCategory,
} from "@/stores/use-config-store";
import type { ComfyWorkflowItem } from "@/services/api/comfyui-default-workflows";

const CATEGORY_LABELS: Record<WorkflowCategory, string> = {
    omniVideo: "全能参考视频",
    frameVideo: "首尾帧视频",
    faceRefine: "视频人脸修复",
    depthVideo: "深度视频提取",
    t2i: "文生图",
    i2i: "参考图生图",
    inpaint: "局部重绘",
    text: "文本生成",
    audio: "音频生成",
    superResolve: "超分辨率",
    angle: "多角度",
    upscale: "高清放大",
};

export type ChannelWorkflowPickerProps = {
    category: WorkflowCategory | WorkflowCategory[];
    preferredCategory?: WorkflowCategory;
    channelId?: string;
    workflowId?: string;
    onChange: (channelId: string, workflowId: string, workflow?: ComfyWorkflowItem) => void;
    className?: string;
};

export function ChannelWorkflowPicker({
    category,
    preferredCategory,
    channelId,
    workflowId,
    onChange,
    className,
}: ChannelWorkflowPickerProps) {
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    const channels = useMemo(() => config.channels || [], [config.channels]);

    // 当前解析生效的渠道
    const activeChannel = useMemo(() => {
        if (!channels.length) return null;
        return (channelId ? channels.find((c) => c.id === channelId) : null) || channels[0];
    }, [channels, channelId]);

    // 当前渠道下匹配 category 的工作流列表
    const workflows = useMemo(() => {
        if (!activeChannel) return [];
        return getChannelWorkflows(activeChannel, category);
    }, [activeChannel, category]);

    // 当前解析生效的工作流
    const activeWorkflow = useMemo(() => {
        if (!workflows.length) return null;
        if (workflowId) {
            const found = workflows.find((w) => w.id === workflowId);
            if (found) return found;
        }
        if (preferredCategory) {
            const preferred = getDefaultWorkflow(activeChannel, preferredCategory);
            if (preferred && workflows.some((w) => w.id === preferred.id)) {
                return preferred;
            }
        }
        return getDefaultWorkflow(activeChannel, category) || workflows[0];
    }, [workflows, workflowId, activeChannel, category, preferredCategory]);

    // 若当前传入的 channelId 或 workflowId 与实际计算不一致，自动校准
    useEffect(() => {
        if (!activeChannel) return;
        if (!activeWorkflow) {
            if (workflowId || activeChannel.id !== channelId) onChange(activeChannel.id, "", undefined);
            return;
        }
        if (activeChannel.id !== channelId || activeWorkflow.id !== workflowId) {
            onChange(activeChannel.id, activeWorkflow.id, activeWorkflow);
        }
    }, [activeChannel, activeWorkflow, channelId, workflowId, onChange]);

    const handleChannelChange = (nextChannelId: string) => {
        const nextChannel = channels.find((c) => c.id === nextChannelId);
        if (!nextChannel) return;
        const targetCategory = activeWorkflow?.category || preferredCategory;
        let defaultWf = targetCategory ? getDefaultWorkflow(nextChannel, targetCategory) : undefined;
        if (!defaultWf) {
            defaultWf = getDefaultWorkflow(nextChannel, category);
        }
        onChange(nextChannelId, defaultWf?.id || "", defaultWf);
    };

    const handleWorkflowChange = (nextWorkflowId: string) => {
        if (!activeChannel) return;
        const nextWf = workflows.find((w) => w.id === nextWorkflowId);
        onChange(activeChannel.id, nextWorkflowId, nextWf);
    };

    const workflowOptions = useMemo(() => {
        const showCategory = Array.isArray(category) && category.length > 1;
        return workflows.map((wf) => ({
            value: wf.id,
            label: (
                <span className="flex items-center gap-1 text-xs">
                    <Workflow className="size-3 shrink-0 text-blue-500" />
                    <span className="truncate">{wf.name}</span>
                    {showCategory && <span className="shrink-0 text-[10px] text-stone-400">·{CATEGORY_LABELS[wf.category]}</span>}
                    {wf.isDefault && <span className="shrink-0 text-[10px] text-stone-400">·默认</span>}
                </span>
            ),
        }));
    }, [category, workflows]);

    if (!channels.length) {
        return (
            <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={() => openConfigDialog(true)}
            >
                未配置渠道，点击添加
            </button>
        );
    }

    return (
        <div
            className={`flex items-center gap-1.5 ${className || ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            {/* 1. 渠道下拉 */}
            <Select
                size="small"
                value={activeChannel?.id}
                onChange={handleChannelChange}
                className="w-[110px] shrink-0"
                popupMatchSelectWidth={false}
                options={channels.map((c) => ({
                    value: c.id,
                    label: (
                        <span className="flex items-center gap-1 text-xs">
                            <Server className="size-3 shrink-0 text-stone-400" />
                            <span className="truncate">{c.name}</span>
                        </span>
                    ),
                }))}
            />

            {/* 2. 工作流下拉 */}
            <Select
                size="small"
                value={activeWorkflow?.id}
                onChange={handleWorkflowChange}
                className="min-w-[130px] max-w-[170px] flex-1"
                popupMatchSelectWidth={false}
                placeholder={workflows.length ? "选择工作流" : "暂无工作流"}
                options={workflowOptions}
            />
        </div>
    );
}
