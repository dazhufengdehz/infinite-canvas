import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, Input, InputNumber, Select, Tooltip } from "antd";
import { ChevronDown, ChevronUp, Copy, Image as ImageIcon, MapPin, Music, Sparkles, Trash2, Upload, Users, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { MINIMAX_H3_SIZES } from "@/services/api/models/video-minimax-h3-omni";
import {
    assetLabel,
    PRODUCTION_H3_SECTIONS,
    PRODUCTION_SHOT_LIMITS,
    validateShot,
    type ProductionShotView,
} from "@/lib/production/production-model";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ProductionOptions, type ScriptAsset, type ScriptAssetKind, type ScriptShot } from "@/types/canvas";

export function MediaPreview({ node, kind }: { node?: CanvasNodeData; kind: ScriptAssetKind | "shot" }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const content = node?.metadata?.content;
    const type = kind === "shot" ? CanvasNodeType.Video : kind === "audio" ? CanvasNodeType.Audio : kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
    if (!content) {
        return (
            <div className="grid h-full w-full place-items-center rounded-lg border" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                <span className="text-xs">{t("canvas.production.mediaEmpty")}</span>
            </div>
        );
    }
    if (type === CanvasNodeType.Audio) return <audio className="w-full" controls src={content} />;
    if (type === CanvasNodeType.Video) return <video className="size-full object-cover" controls src={content} />;
    return <img src={content} alt="" className="size-full object-cover" />;
}

export function AssetEditor({
    asset,
    node,
    disabled,
    usages,
    onSave,
    onGenerate,
    onUpload,
    onDuplicate,
    onRemove,
    onLocate,
}: {
    asset: ScriptAsset;
    node?: CanvasNodeData;
    disabled: boolean;
    usages: ProductionShotView[];
    onSave: (asset: ScriptAsset) => void;
    onGenerate: () => void;
    onUpload: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
    onLocate: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<ScriptAsset>(asset);
    const dirty = draft.name !== asset.name || draft.description !== asset.description || draft.prompt !== asset.prompt;

    return (
        <div className="space-y-4">
            <EditorHeader title={assetLabel(asset)} node={node} onLocate={onLocate} />
            <div className="flex items-start gap-4">
                <div className="h-[140px] w-[220px] shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                    <MediaPreview node={node} kind={asset.kind} />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<Upload className="size-4" />} onClick={onUpload}>{t("canvas.production.upload")}</Button>
                    <Button size="small" icon={<Sparkles className="size-4" />} disabled={disabled} onClick={onGenerate}>{t("canvas.production.generate")}</Button>
                    <Button size="small" icon={<Copy className="size-4" />} onClick={onDuplicate}>{t("canvas.production.duplicate")}</Button>
                    <Button size="small" danger icon={<Trash2 className="size-4" />} onClick={onRemove}>{t("canvas.production.remove")}</Button>
                </div>
            </div>
            <Field label={t("canvas.production.assetName")}>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={t("canvas.production.assetDescription")}>
                <Input.TextArea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} autoSize={{ minRows: 3, maxRows: 8 }} />
            </Field>
            <Field label={t("canvas.production.assetPrompt")}>
                <Input.TextArea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} autoSize={{ minRows: 6, maxRows: 16 }} />
            </Field>
            <Button size="small" disabled={disabled || !dirty || !draft.name.trim()} onClick={() => onSave(draft)}>{t("canvas.production.save")}</Button>
            <div className="space-y-1">
                <div className="text-xs font-medium">{t("canvas.production.usages", { count: usages.length })}</div>
                {usages.length ? usages.map((shot) => (
                    <div key={shot.key} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs" style={{ borderColor: theme.node.stroke }}>
                        <span className="min-w-0 flex-1 truncate">{shot.title || t("canvas.production.untitled")}</span>
                        <span className="shrink-0 text-[10px]" style={{ color: theme.node.muted }}>{t("canvas.production.shotMetaShort", { episode: shot.episodeNumber, number: shot.number })}</span>
                    </div>
                )) : <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.production.usageEmpty")}</p>}
            </div>
            <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.production.assetHint")}</p>
        </div>
    );
}

export function ShotEditor({
    shot,
    assets,
    orientation,
    node,
    disabled,
    isReady,
    onSave,
    onRegenerate,
    onGenerate,
    onLocate,
}: {
    shot: ProductionShotView;
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    node?: CanvasNodeData;
    disabled: boolean;
    isReady: (id: string) => boolean;
    onSave: (next: ScriptShot) => void;
    onRegenerate: () => void;
    onGenerate: () => void;
    onLocate: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<ScriptShot>(() => toShot(shot));
    const dirty =
        draft.title !== shot.title ||
        draft.duration !== shot.duration ||
        draft.size !== shot.size ||
        draft.imageAssetIds.join(",") !== shot.imageAssetIds.join(",") ||
        draft.videoAssetIds.join(",") !== shot.videoAssetIds.join(",") ||
        draft.audioAssetIds.join(",") !== shot.audioAssetIds.join(",") ||
        PRODUCTION_H3_SECTIONS.some((section) => draft.h3[section] !== shot.h3[section]);

    const errors = validateShot(draft, assets, orientation);
    const missing = [...draft.imageAssetIds, ...draft.videoAssetIds, ...draft.audioAssetIds].filter((id) => !isReady(id));
    const workflowMissing = !node?.metadata?.workflowId;
    const sizeOptions = useMemo(
        () =>
            MINIMAX_H3_SIZES.filter((size) => {
                const [w, h] = size.split("x").map(Number);
                return orientation === "horizontal" ? w > h : h > w;
            }).map((size) => {
                const [w, h] = size.split("x").map(Number);
                return { value: size, label: `${size} · ${((w * h) / 1e6).toFixed(2)}MP` };
            }),
        [orientation],
    );
    const patch = (value: Partial<ScriptShot>) => setDraft({ ...draft, ...value });
    const labelOf = (id: string) => {
        const asset = assets.find((item) => item.id === id);
        return asset ? assetLabel(asset) : t("canvas.production.unknownAsset", { id: id.slice(0, 6) });
    };

    return (
        <div className="space-y-3">
            <EditorHeader title={shot.title || t("canvas.production.untitled")} node={node} onLocate={onLocate} />
            <div className="grid grid-cols-3 gap-3">
                <Field label={t("canvas.production.shotTitle")}>
                    <Input value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
                </Field>
                <Field label={t("canvas.production.shotDuration")}>
                    <InputNumber className="w-full" min={1} max={15} step={1} precision={0} value={draft.duration} onChange={(value) => patch({ duration: Number(value) || 0 })} />
                </Field>
                <Field label={t("canvas.production.shotSize")}>
                    <Select className="w-full" value={draft.size} options={sizeOptions} onChange={(value) => patch({ size: value })} />
                </Field>
            </div>
            <ReferenceList label={t("canvas.production.referenceImages")} limit={PRODUCTION_SHOT_LIMITS.image} ids={draft.imageAssetIds} assets={assets.filter((asset) => asset.kind !== "video" && asset.kind !== "audio")} onChange={(ids) => patch({ imageAssetIds: ids })} labelOf={labelOf} isReady={isReady} />
            <ReferenceList label={t("canvas.production.referenceVideos")} limit={PRODUCTION_SHOT_LIMITS.video} ids={draft.videoAssetIds} assets={assets.filter((asset) => asset.kind === "video")} onChange={(ids) => patch({ videoAssetIds: ids })} labelOf={labelOf} isReady={isReady} />
            <ReferenceList label={t("canvas.production.referenceAudios")} limit={PRODUCTION_SHOT_LIMITS.audio} ids={draft.audioAssetIds} assets={assets.filter((asset) => asset.kind === "audio")} onChange={(ids) => patch({ audioAssetIds: ids })} labelOf={labelOf} isReady={isReady} />
            {PRODUCTION_H3_SECTIONS.map((section) => (
                <Field key={section} label={section}>
                    <Input.TextArea value={draft.h3[section]} onChange={(event) => patch({ h3: { ...draft.h3, [section]: event.target.value } })} autoSize={{ minRows: 3, maxRows: 12 }} />
                </Field>
            ))}
            {errors.length ? (
                <ul className="space-y-0.5 rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: theme.state.danger, color: theme.state.danger }}>
                    {errors.map((error) => <li key={error}>{error}</li>)}
                </ul>
            ) : null}
            {missing.length ? <p className="text-xs" style={{ color: theme.state.warning }}>{t("canvas.production.referenceMissing", { count: missing.length })}</p> : null}
            {workflowMissing ? <p className="text-xs" style={{ color: theme.state.danger }}>{t("canvas.script.h3Missing")}</p> : null}
            <div className="flex gap-2">
                <Button size="small" disabled={disabled || !dirty || errors.length > 0} onClick={() => onSave(draft)}>{t("canvas.production.save")}</Button>
                <Button size="small" type="text" icon={<Sparkles className="size-4" />} disabled={disabled} onClick={onRegenerate}>{t("canvas.production.regenerate")}</Button>
                <Tooltip title={errors.length ? t("canvas.production.generateBlocked") : missing.length ? t("canvas.production.referenceMissingTooltip") : workflowMissing ? t("canvas.script.h3Missing") : ""}>
                    <Button size="small" type="text" icon={<Video className="size-4" />} disabled={disabled || errors.length > 0 || missing.length > 0 || workflowMissing} onClick={onGenerate}>
                        {t("canvas.production.generate")}
                    </Button>
                </Tooltip>
            </div>
            <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.production.shotHint")}</p>
        </div>
    );
}

export function ReferenceList({ label, limit, ids, assets, onChange, labelOf, isReady }: { label: string; limit: number; ids: string[]; assets: ScriptAsset[]; onChange: (ids: string[]) => void; labelOf: (id: string) => string; isReady: (id: string) => boolean }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const available = assets.filter((asset) => !ids.includes(asset.id)).map((asset) => ({ value: asset.id, label: assetLabel(asset) }));
    const move = (index: number, offset: number) => {
        const next = ids.slice();
        const target = index + offset;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{label}</span>
                <span className="text-[11px]" style={{ color: theme.node.muted }}>{ids.length}/{limit}</span>
                <Select size="small" className="w-[220px]" value={null} placeholder={t("canvas.production.addReference")} options={available} disabled={ids.length >= limit} onChange={(value: string) => onChange([...ids, value])} />
            </div>
            {ids.map((id, index) => (
                <div key={id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs" style={{ borderColor: theme.node.stroke, opacity: isReady(id) ? 1 : 0.6 }}>
                    <span className="shrink-0" style={{ color: theme.node.muted }}>#{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{labelOf(id)}</span>
                    <Button size="small" type="text" icon={<ChevronUp className="size-3.5" />} disabled={index === 0} onClick={() => move(index, -1)} />
                    <Button size="small" type="text" icon={<ChevronDown className="size-3.5" />} disabled={index === ids.length - 1} onClick={() => move(index, 1)} />
                    <Button size="small" type="text" icon={<X className="size-3.5" />} onClick={() => onChange(ids.filter((value) => value !== id))} />
                </div>
            ))}
        </div>
    );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-1">
            <span className="text-xs font-medium">{label}</span>
            {children}
        </label>
    );
}

export function EditorHeader({ title, node, onLocate }: { title: string; node?: CanvasNodeData; onLocate: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
            <span className="text-xs" style={{ color: theme.node.muted }}>{node ? node.title : t("canvas.production.noNode")}</span>
            <Tooltip title={t("canvas.production.locate")}>
                <Button size="small" type="text" disabled={!node} icon={<MapPin className="size-4" />} onClick={onLocate} />
            </Tooltip>
        </div>
    );
}

export const ASSET_KIND_ICON: Record<ScriptAssetKind, typeof ImageIcon> = { character: Users, scene: MapPin, prop: ImageIcon, video: Video, audio: Music };

function toShot(shot: ScriptShot): ScriptShot {
    return { id: shot.id, number: shot.number, title: shot.title, duration: shot.duration, size: shot.size, imageAssetIds: shot.imageAssetIds, videoAssetIds: shot.videoAssetIds, audioAssetIds: shot.audioAssetIds, h3: shot.h3 };
}
