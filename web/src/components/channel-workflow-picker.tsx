import { Select } from "antd";
import { useEffect, useMemo } from "react";
import { Workflow } from "lucide-react";

import {
    getChannelWorkflows,
    getDefaultWorkflow,
    useConfigStore,
    useEffectiveConfig,
    type ComfyWorkflowItem,
    type WorkflowCategory,
} from "@/stores/use-config-store";

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

    // 当前解析生效的渠道（仅用于默认兜底）
    const activeChannel = useMemo(() => {
        if (!channels.length) return null;
        return (channelId ? channels.find((c) => c.id === channelId) : null) || channels[0];
    }, [channels, channelId]);

    // 所有渠道下匹配 category 的工作流拍平成单列表，当前渠道优先
    const allEntries = useMemo(() => {
        const ordered = activeChannel
            ? [activeChannel, ...channels.filter((c) => c.id !== activeChannel.id)]
            : channels;
        return ordered.flatMap((channel) =>
            getChannelWorkflows(channel, category).map((wf) => ({ channel, wf })),
        );
    }, [channels, activeChannel, category]);

    // 当前解析生效的工作流（跨渠道查找）
    const activeEntry = useMemo(() => {
        if (!allEntries.length) return null;
        if (workflowId) {
            const found =
                allEntries.find((e) => e.wf.id === workflowId && (!channelId || e.channel.id === channelId)) ||
                allEntries.find((e) => e.wf.id === workflowId);
            if (found) return found;
        }
        if (preferredCategory) {
            const preferred = getDefaultWorkflow(activeChannel, preferredCategory);
            const found = preferred && allEntries.find((e) => e.wf.id === preferred.id);
            if (found) return found;
        }
        const def = getDefaultWorkflow(activeChannel, category);
        return (def && allEntries.find((e) => e.wf.id === def.id)) || allEntries[0];
    }, [allEntries, workflowId, channelId, activeChannel, category, preferredCategory]);

    const activeWorkflow = activeEntry?.wf ?? null;

    // 若当前传入的 channelId 或 workflowId 与实际计算不一致，自动校准
    useEffect(() => {
        const entryChannelId = activeEntry?.channel.id;
        if (!activeChannel || !entryChannelId) return;
        if (!activeWorkflow) {
            if (workflowId || activeChannel.id !== channelId) onChange(activeChannel.id, "", undefined);
            return;
        }
        if (entryChannelId !== channelId || activeWorkflow.id !== workflowId) {
            onChange(entryChannelId, activeWorkflow.id, activeWorkflow);
        }
    }, [activeEntry, activeChannel, activeWorkflow, channelId, workflowId, onChange]);

    const showCategory = Array.isArray(category) && category.length > 1;

    const workflowOptions = useMemo(
        () =>
            allEntries.map(({ channel, wf }) => ({
                value: JSON.stringify([channel.id, wf.id]),
                label: (
                    <span className="flex items-center gap-1 text-xs">
                        <Workflow className="size-3 shrink-0 text-blue-500" />
                        <span className="truncate">{wf.name}</span>
                        {showCategory && (
                            <span className="shrink-0 text-[10px] text-stone-400">·{CATEGORY_LABELS[wf.category]}</span>
                        )}
                        {wf.isDefault && <span className="shrink-0 text-[10px] text-stone-400">·默认</span>}
                    </span>
                ),
            })),
        [allEntries, showCategory],
    );

    const handleChange = (value: string) => {
        const [selectedChannelId, selectedWorkflowId] = JSON.parse(value) as [string, string];
        const entry = allEntries.find(
            (e) => e.channel.id === selectedChannelId && e.wf.id === selectedWorkflowId,
        );
        if (!entry) return;
        onChange(entry.channel.id, entry.wf.id, entry.wf);
    };

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

    const selectValue = activeEntry ? JSON.stringify([activeEntry.channel.id, activeEntry.wf.id]) : undefined;

    return (
        <div
            className={`flex items-center gap-1.5 ${className || ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <Select
                size="small"
                value={selectValue}
                onChange={handleChange}
                className="min-w-[130px] max-w-[260px] flex-1"
                popupMatchSelectWidth={false}
                placeholder={allEntries.length ? "选择工作流" : "暂无工作流"}
                options={workflowOptions}
                labelRender={() => (
                    <span className="flex items-center gap-1 text-xs truncate">
                        <Workflow className="size-3 shrink-0 text-blue-500" />
                        <span className="truncate">{activeWorkflow?.name || "选择工作流"}</span>
                    </span>
                )}
            />
        </div>
    );
}
