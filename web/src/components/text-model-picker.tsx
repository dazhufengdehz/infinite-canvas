import { Select, Tooltip } from "antd";
import { AlertTriangle, HelpCircle, Sparkles, Workflow } from "lucide-react";
import { useMemo } from "react";

import {
    BUILTIN_TEXT_WORKFLOW_MODELS,
    buildCustomWorkflowProfile,
    CUSTOM_WORKFLOW_CATEGORIES,
    evaluateModelAvailability,
    findCustomWorkflowProfile,
    getModelProfile,
    textQwen35Profile,
    type WorkflowModelProfile,
} from "@/services/api/models";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { getDefaultWorkflow, useEffectiveConfig } from "@/stores/use-config-store";

export type TextModelPickerProps = {
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
    return <Sparkles className="size-3.5 shrink-0 text-emerald-500" />;
}

export function TextModelPicker({
    channelId,
    modelId,
    onChange,
    className = "",
    disabled = false,
    connectedImages = 0,
    connectedVideos = 0,
    connectedAudios = 0,
    promptText = "",
}: TextModelPickerProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();

    const channels = useMemo(() => {
        return config.channels && config.channels.length > 0
            ? config.channels
            : [{ id: "builtin", name: "系统内置 ComfyUI", baseUrl: "http://127.0.0.1:8188", apiKey: "", apiFormat: "comfyui" as const, models: [] }];
    }, [config.channels]);

    const activeChannel = useMemo(() => {
        return (channelId ? channels.find((c) => c.id === channelId) : null) || channels[0];
    }, [channels, channelId]);

    const activeProfile = useMemo(() => {
        if (modelId) {
            const profile = getModelProfile(modelId) || findCustomWorkflowProfile(activeChannel, modelId, CUSTOM_WORKFLOW_CATEGORIES.text);
            if (profile) return profile;
        }
        const defaultWf = activeChannel ? getDefaultWorkflow(activeChannel, "text") : undefined;
        if (defaultWf) {
            const profile = getModelProfile(defaultWf.id) || findCustomWorkflowProfile(activeChannel, defaultWf.id, CUSTOM_WORKFLOW_CATEGORIES.text);
            if (profile) return profile;
        }
        return textQwen35Profile;
    }, [modelId, activeChannel]);
    const activeIsCustom = Boolean(activeChannel.workflows?.some((workflow) => !workflow.isBuiltin && workflow.id === activeProfile.id));

    const options = useMemo(() => {
        const orderedChannels = [activeChannel, ...channels.filter((channel) => channel.id !== activeChannel.id)];
        return orderedChannels.flatMap((channel) => [
            ...BUILTIN_TEXT_WORKFLOW_MODELS,
            ...(channel.workflows || []).filter((workflow) => !workflow.isBuiltin && CUSTOM_WORKFLOW_CATEGORIES.text.includes(workflow.category)).map(buildCustomWorkflowProfile),
        ].map((model) => {
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
        return JSON.stringify([activeChannel.id, activeProfile.id]);
    }, [activeChannel.id, activeProfile.id]);

    const handleSelectChange = (value: string) => {
        const [selectedChannelId, selectedModelId] = JSON.parse(value) as [string, string];
        const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) || activeChannel;
        const found = getModelProfile(selectedModelId) || findCustomWorkflowProfile(selectedChannel, selectedModelId, CUSTOM_WORKFLOW_CATEGORIES.text);
        if (!found) return;
        onChange(selectedChannelId, found.id, found);
    };

    const activeAvailability = useMemo(() => {
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
            options={options}
            onChange={handleSelectChange}
            popupMatchSelectWidth={false}
            disabled={disabled}
            allowClear={false}
            popupClassName="canvas-model-picker-dropdown"
            className={`canvas-compact-control !h-8 !rounded-lg !text-xs ${className}`}
            style={{
                background: "transparent",
                borderColor: activeAvailability.isAvailable ? theme.node.stroke : "#f59e0b",
                color: theme.node.text,
                height: "32px",
            }}
            labelRender={() => (
                <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                    {activeIsCustom ? <Workflow className="size-3.5 shrink-0 text-cyan-500" /> : getModelIcon(activeProfile.id)}
                    <span className="font-semibold text-xs truncate">{activeProfile.name}</span>
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
                            <AlertTriangle className="size-3 text-amber-500 shrink-0" />
                        </Tooltip>
                    )}
                </div>
            )}
        />
    );
}
