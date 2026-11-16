import { Select, Tooltip } from "antd";
import { AlertTriangle, HelpCircle, Image, Layers, Server, Workflow, Zap } from "lucide-react";
import { useMemo } from "react";

import {
    buildWorkflowModelProfiles,
    CUSTOM_WORKFLOW_CATEGORIES,
    evaluateModelAvailability,
    type WorkflowModelProfile,
} from "@/services/api/models";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { getChannelWorkflows, getDefaultWorkflow, useEffectiveConfig } from "@/stores/use-config-store";

export type ImageModelPickerProps = {
    channelId?: string;
    modelId?: string;
    onChange: (channelId: string, modelId: string, profile: WorkflowModelProfile) => void;
    className?: string;
    disabled?: boolean;
    connectedImages?: number;
    connectedVideos?: number;
    connectedAudios?: number;
    promptText?: string;
};

function getModelIcon(modelId: string) {
    switch (modelId) {
        case "image-z-turbo":
            return <Zap className="size-3.5 shrink-0 text-amber-500" />;
        case "image-moss":
            return <Image className="size-3.5 shrink-0 text-blue-500" />;
        case "image-qwen":
        default:
            return <Layers className="size-3.5 shrink-0 text-emerald-500" />;
    }
}

export function ImageModelPicker({
    channelId,
    modelId,
    onChange,
    className = "",
    disabled = false,
    connectedImages = 0,
    connectedVideos = 0,
    connectedAudios = 0,
    promptText = "",
}: ImageModelPickerProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();

    const channels = useMemo(() => {
        return (config.channels && config.channels.length > 0)
            ? config.channels
            : [{ id: "builtin", name: "系统内置 ComfyUI", baseUrl: "http://127.0.0.1:8188", apiKey: "", apiFormat: "comfyui" as const, models: [] }];
    }, [config.channels]);

    const activeChannel = useMemo(() => {
        return (channelId ? channels.find((c) => c.id === channelId) : null) || channels[0];
    }, [channels, channelId]);

    const activeProfiles = useMemo(
        () => buildWorkflowModelProfiles(getChannelWorkflows(activeChannel, CUSTOM_WORKFLOW_CATEGORIES.image)),
        [activeChannel],
    );
    const activeProfile = useMemo(() => {
        const selected = activeProfiles.find((profile) => profile.id === modelId);
        if (selected) return selected;
        const defaultWf = getDefaultWorkflow(activeChannel, CUSTOM_WORKFLOW_CATEGORIES.image);
        const defaultProfile = defaultWf ? buildWorkflowModelProfiles([defaultWf])[0] : undefined;
        return activeProfiles.find((profile) => profile.id === defaultProfile?.id) || activeProfiles[0];
    }, [modelId, activeProfiles, activeChannel]);
    const activeIsCustom = Boolean(activeChannel.workflows?.some((workflow) => !workflow.isBuiltin && workflow.id === activeProfile?.id));

    const options = useMemo(() => {
        const orderedChannels = [activeChannel, ...channels.filter((channel) => channel.id !== activeChannel.id)];
        return orderedChannels.flatMap((channel) =>
            buildWorkflowModelProfiles(getChannelWorkflows(channel, CUSTOM_WORKFLOW_CATEGORIES.image)).map((model) => {
            const isCustom = Boolean(channel.workflows?.some((workflow) => !workflow.isBuiltin && workflow.id === model.id));
            const availability = evaluateModelAvailability({
                targetModel: model,
                connectedImages,
                connectedVideos,
                connectedAudios,
                promptText,
                activeChannel: channel,
            });

            const isBlocked = !availability.isSelectable;
            const needsInputs = availability.isSelectable && !availability.isAvailable;

            return {
                value: JSON.stringify([channel.id, model.id]),
                disabled: isBlocked,
                label: (
                    <div className={`flex items-center justify-between gap-2 py-0.5 min-w-[200px] ${isBlocked ? "opacity-60" : ""}`}>
                        <div className="flex items-center gap-1.5 truncate">
                            {isCustom ? <Workflow className="size-3.5 shrink-0 text-cyan-500" /> : getModelIcon(model.id)}
                            <div className="flex min-w-0 flex-col">
                                <span className="font-medium text-xs truncate">{model.name}</span>
                                <span className="truncate text-[10px] opacity-50">{channel.name || "ComfyUI 主机"}{isCustom ? " · 自定义" : ""}</span>
                            </div>
                        </div>
                        {isBlocked ? (
                            <Tooltip
                                title={
                                    <div className="space-y-1 text-xs">
                                        <div className="font-semibold text-rose-400">无法切换（资源冲突）：</div>
                                        {availability.blockingReasons.map((r, i) => (
                                            <div key={i} className="flex items-start gap-1">
                                                <span className="text-rose-400">•</span>
                                                <span>{r}</span>
                                            </div>
                                        ))}
                                    </div>
                                }
                            >
                                <span
                                    className="pointer-events-auto flex items-center gap-0.5 text-rose-500 shrink-0 cursor-help p-0.5 hover:text-rose-600"
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <HelpCircle className="size-3.5" />
                                </span>
                            </Tooltip>
                        ) : needsInputs ? (
                            <Tooltip
                                title={
                                    <div className="space-y-1 text-xs">
                                        <div className="font-semibold text-amber-300">选定后前置要求：</div>
                                        {availability.warningReasons.map((r, i) => (
                                            <div key={i} className="flex items-start gap-1">
                                                <span className="text-amber-400">•</span>
                                                <span>{r}</span>
                                            </div>
                                        ))}
                                    </div>
                                }
                            >
                                <span
                                    className="pointer-events-auto flex items-center gap-0.5 text-amber-500 shrink-0 cursor-help p-0.5 hover:text-amber-600"
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <AlertTriangle className="size-3.5" />
                                </span>
                            </Tooltip>
                        ) : null}
                    </div>
                ),
                model,
                availability,
            };
        }));
    }, [activeChannel, channels, connectedImages, connectedVideos, connectedAudios, promptText]);

    const selectValue = useMemo(() => {
        return activeProfile ? JSON.stringify([activeChannel.id, activeProfile.id]) : undefined;
    }, [activeChannel.id, activeProfile]);

    const handleSelectChange = (value: string) => {
        const [selectedChannelId, selectedModelId] = JSON.parse(value) as [string, string];
        const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) || activeChannel;
        const found = buildWorkflowModelProfiles(getChannelWorkflows(selectedChannel, CUSTOM_WORKFLOW_CATEGORIES.image))
            .find((profile) => profile.id === selectedModelId);
        if (!found) return;
        onChange(selectedChannelId, found.id, found);
    };

    const activeAvailability = useMemo(() => {
        if (!activeProfile) return { isAvailable: false, reasons: ["暂无可用的工作流"] };
        return evaluateModelAvailability({
            targetModel: activeProfile,
            connectedImages,
            connectedVideos,
            connectedAudios,
            promptText,
            activeChannel,
        });
    }, [activeProfile, connectedImages, connectedVideos, connectedAudios, promptText, activeChannel]);

    return (
        <Select
            value={selectValue}
            placeholder="暂无工作流"
            options={options}
            onChange={handleSelectChange}
            popupMatchSelectWidth={false}
            allowClear={false}
            disabled={disabled}
            className={`!h-8 min-w-0 !max-w-[280px] ${className}`}
            styles={{
                root: {
                    background: "transparent",
                    color: theme.node.text,
                    height: "32px",
                },
            }}
            labelRender={() => {
                const channelName = activeChannel?.name || "ComfyUI";

                return (
                    <div className="flex items-center gap-1.5 truncate text-xs">
                        <Server className="size-3.5 shrink-0 text-blue-500 opacity-80" />
                        <span className="truncate max-w-[80px] font-medium opacity-85">
                            {channelName}
                        </span>
                        <span className="opacity-30">/</span>
                        {activeIsCustom ? <Workflow className="size-3.5 shrink-0 text-cyan-500" /> : getModelIcon(activeProfile?.id || "")}
                        <span className="truncate font-medium">{activeProfile?.name || "暂无工作流"}</span>
                        {!activeAvailability.isAvailable && (
                            <Tooltip
                                title={
                                    <div className="space-y-1 text-xs">
                                        <div className="font-semibold text-amber-300">当前不可用：</div>
                                        {activeAvailability.reasons.map((r, i) => (
                                            <div key={i} className="flex items-start gap-1">
                                                <span className="text-amber-400">•</span>
                                                <span>{r}</span>
                                            </div>
                                        ))}
                                    </div>
                                }
                            >
                                <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-medium shrink-0 cursor-help">
                                    <AlertTriangle className="size-3" />
                                    <HelpCircle className="size-3" />
                                </span>
                            </Tooltip>
                        )}
                    </div>
                );
            }}
        />
    );
}
