import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { Button } from "antd";

import { useDeferredOutsideClick } from "./use-deferred-outside-click";
import { AudioSettingsPanel, audioSecondsLabel } from "@/components/audio-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { type WorkflowModelProfile } from "@/services/api/models";

export type CanvasAudioSettingKey = "audioSeconds";

type CanvasAudioSettingsPopoverProps = {
    config: AiConfig;
    modelId?: string;
    profile?: WorkflowModelProfile;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasAudioSettingsPopover({ config, modelId, profile: profileProp, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: CanvasAudioSettingsPopoverProps) {
    const profile = profileProp;
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

    if (!profile?.capabilityConfig.duration) return null;

    const panel = open && buttonRect ? <AudioSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} modelId={modelId} profile={profile} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <Button size="small" type="text" className={buttonClassName || "!h-8 !max-w-[120px] !justify-start !rounded-lg !px-2.5"} style={{ background: "transparent", color: theme.text.primary }} icon={<Clock className="size-3.5" />} onClick={() => updateOpen(!open)}>
                    <span className="truncate">
                        {audioSecondsLabel(config.audioSeconds, modelId, profile)}
                    </span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function AudioSettingsPortal({
    buttonRect,
    panelRef,
    placement,
    theme,
    config,
    modelId,
    profile,
    onConfigChange,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasAudioSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    modelId?: string;
    profile: WorkflowModelProfile;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
}) {
    const width = 344;
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
        overflowX: "hidden",
        boxSizing: "border-box",
        color: theme.text.primary,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            style={style}
            data-canvas-no-zoom
            className="canvas-image-settings-popover thin-scrollbar"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <AudioSettingsPanel config={config} modelId={modelId} profile={profile} onConfigChange={onConfigChange} theme={theme} className="space-y-3" />
        </div>,
        document.body,
    );
}
