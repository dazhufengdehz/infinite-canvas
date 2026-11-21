import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button, Select } from "antd";

import { useDeferredOutsideClick } from "./use-deferred-outside-click";

import {
    extractVideoSizeTiers,
    normalizeVideoSizeValue,
    parseVideoSize,
    VideoSettingsPanel,
    videoSecondsLabel,
    videoSizeLabel,
} from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { resolveVideoModelIdForMode, type WorkflowModelProfile } from "@/services/api/models";

export type CanvasVideoSettingsPopoverProps = {
    modelId?: string;
    profile?: WorkflowModelProfile;
    allowModeSwitch?: boolean;
    size?: string;
    duration?: number | string;
    videoMode?: "omni" | "frame";
    onParamChange?: (patch: {
        modelId?: string;
        videoMode?: "omni" | "frame";
        size?: string;
        seconds?: string;
        duration?: number;
    }) => void;
    config?: AiConfig;
    onConfigChange?: (key: keyof AiConfig, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    inline?: boolean;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasVideoSettingsPopover({
    modelId,
    profile: profileProp,
    allowModeSwitch = true,
    size,
    duration,
    videoMode,
    onParamChange,
    config,
    onConfigChange,
    onOpenChange,
    inline = false,
    buttonClassName,
    placement = "topLeft",
}: CanvasVideoSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChangeRef.current?.(nextOpen);
    };

    useDeferredOutsideClick({
        open,
        onClose: () => updateOpen(false),
        ignoreRefs: [buttonRef, panelRef],
        blurElementRef: panelRef,
        onSyncPosition: () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null),
    });

    const effectiveModelId = modelId;
    const profile = profileProp;
    if (!profile) return null;
    const currentMode = videoMode || (profile.category === "frameVideo" ? "frame" : (config?.videoMode === "frame" ? "frame" : "omni"));
    const currentSize = size || config?.size;
    const currentDuration = duration !== undefined ? duration : config?.videoSeconds;

    if (inline) {
        const fields: Array<{
            key: string;
            label: string;
            value: string;
            options: Array<{ value: string; label: string }>;
            onChange: (value: string) => void;
        }> = [];

        if (allowModeSwitch) {
            fields.push({
                key: "mode",
                label: "生成模式",
                value: currentMode,
                options: [
                    { value: "omni", label: "全能参考" },
                    { value: "frame", label: "首尾帧" },
                ],
                onChange: (value) => {
                    const nextMode = value as "omni" | "frame";
                    onParamChange?.({ modelId: resolveVideoModelIdForMode(profile.id, nextMode), videoMode: nextMode });
                    onConfigChange?.("videoMode", nextMode);
                },
            });
        }

        const sizeConfig = profile.capabilityConfig.size;
        if (sizeConfig) {
            const tiers = extractVideoSizeTiers(sizeConfig.values);
            const normalizedSize = normalizeVideoSizeValue(currentSize, profile);
            const { aspect, tier: selectedTier } = parseVideoSize(normalizedSize, tiers);
            const selectSize = (nextAspect: "16:9" | "9:16", tier = selectedTier) => {
                const nextW = nextAspect === "16:9" ? tier.landscapeW : tier.landscapeH;
                const nextH = nextAspect === "16:9" ? tier.landscapeH : tier.landscapeW;
                const nextSize = `${nextW}x${nextH}`;
                onParamChange?.({ size: nextSize });
                onConfigChange?.("size", nextSize);
            };
            fields.push({
                key: "aspect",
                label: "视频宽高比",
                value: aspect,
                options: [
                    { value: "16:9", label: "16:9 横屏" },
                    { value: "9:16", label: "9:16 竖屏" },
                ],
                onChange: (value) => selectSize(value as "16:9" | "9:16"),
            });
            fields.push({
                key: "size",
                label: "生成尺寸",
                value: `${selectedTier.landscapeW}x${selectedTier.landscapeH}`,
                options: tiers.map((tier) => ({
                    value: `${tier.landscapeW}x${tier.landscapeH}`,
                    label: aspect === "16:9" ? `${tier.landscapeW} × ${tier.landscapeH}` : `${tier.landscapeH} × ${tier.landscapeW}`,
                })),
                onChange: (value) => {
                    const tier = tiers.find((item) => `${item.landscapeW}x${item.landscapeH}` === value);
                    if (tier) selectSize(aspect, tier);
                },
            });
        }

        const durationConfig = profile.capabilityConfig.duration;
        if (durationConfig) {
            const min = durationConfig.min ?? 1;
            const max = durationConfig.max ?? 15;
            const step = durationConfig.step ?? 1;
            const durations = Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, index) => Number((min + index * step).toFixed(2)));
            fields.push({
                key: "duration",
                label: "视频时长",
                value: videoSecondsLabel(currentDuration, profile),
                options: durations.map((value) => ({ value: `${value}s`, label: `${value} 秒` })),
                onChange: (value) => {
                    const seconds = Number.parseFloat(value);
                    onParamChange?.({ seconds: String(seconds), duration: seconds });
                    onConfigChange?.("videoSeconds", String(seconds));
                },
            });
        }

        if (fields.length === 0) return null;

        return (
            <div
                data-canvas-video-settings
                className="grid min-w-0 gap-1.5"
                style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {fields.map((field) => (
                    <Select key={field.key} size="small" className="!h-8 w-full min-w-0" value={field.value} options={field.options} onChange={field.onChange} aria-label={field.label} />
                ))}
            </div>
        );
    }

    const summary = [
        currentMode === "frame" ? "首尾帧" : "全能参考",
        profile.capabilityConfig.size ? videoSizeLabel(currentSize, profile) : null,
        profile.capabilityConfig.duration ? videoSecondsLabel(currentDuration, profile) : null,
    ].filter(Boolean).join(" · ");

    const panel = open && buttonRect ? (
        <VideoSettingsPortal
            buttonRect={buttonRect}
            panelRef={panelRef}
            placement={placement}
            theme={theme}
            modelId={effectiveModelId}
            profile={profile}
            allowModeSwitch={allowModeSwitch}
            size={currentSize}
            duration={currentDuration}
            videoMode={currentMode}
            onParamChange={onParamChange}
            config={config}
            onConfigChange={onConfigChange}
        />
    ) : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <Button size="small" type="text" className={buttonClassName || "!h-8 !max-w-[230px] !justify-start !rounded-lg !px-2.5"} style={{ background: "transparent", color: theme.text.primary }} icon={<Settings2 className="size-3.5" />} onClick={() => updateOpen(!open)}>
                    <span className="truncate">
                        {summary}
                    </span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function VideoSettingsPortal({
    buttonRect,
    panelRef,
    placement,
    theme,
    modelId,
    profile,
    allowModeSwitch,
    size,
    duration,
    videoMode,
    onParamChange,
    config,
    onConfigChange,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasVideoSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    modelId?: string;
    profile: WorkflowModelProfile;
    allowModeSwitch: boolean;
    size?: string;
    duration?: number | string;
    videoMode?: "omni" | "frame";
    onParamChange?: CanvasVideoSettingsPopoverProps["onParamChange"];
    config?: AiConfig;
    onConfigChange?: (key: keyof AiConfig, value: string) => void;
}) {
    const width = 380;
    const gap = 8;
    const margin = 12;
    const spaceAbove = buttonRect.top - gap - margin;
    const spaceBelow = window.innerHeight - buttonRect.bottom - gap - margin;
    const preferTop = placement?.startsWith("top");
    const isTop = preferTop ? (spaceAbove >= 260 || spaceAbove >= spaceBelow) : (spaceBelow < 260 && spaceAbove > spaceBelow);
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(isTop
            ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(200, Math.min(window.innerHeight - margin * 2, spaceAbove)) }
            : { top: buttonRect.bottom + gap, maxHeight: Math.max(200, Math.min(window.innerHeight - margin * 2, spaceBelow)) }),
        background: theme.surface.base,
        border: `1px solid ${theme.hairline.base}`,
        borderRadius: 14,
        boxShadow: "var(--elevation-float)",
        padding: 18,
        overflowY: "auto",
        color: theme.text.primary,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            data-canvas-no-zoom
            className="canvas-image-settings-popover thin-scrollbar"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <VideoSettingsPanel
                modelId={modelId}
                profile={profile}
                allowModeSwitch={allowModeSwitch}
                size={size}
                duration={duration}
                videoMode={videoMode}
                onParamChange={onParamChange}
                config={config}
                onConfigChange={onConfigChange as any}
                theme={theme}
                className="space-y-3"
            />
        </div>,
        document.body,
    );
}
