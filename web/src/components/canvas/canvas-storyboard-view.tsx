import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { App, Button, Empty, Input, InputNumber, Select, Tooltip } from "antd";
import { ChevronDown, ChevronUp, Clapperboard, Image as ImageIcon, MapPin, Music, RefreshCw, Sparkles, Square, Upload, Users, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { assetLabel, buildScriptProjectView, replaceEpisodeBlock, SCRIPT_ASSET_KINDS, SCRIPT_ASSET_KIND_LABEL, SCRIPT_H3_SECTIONS, SCRIPT_SHOT_LIMITS, validateH3Shot, type ScriptAssetView, type ScriptEpisodeView, type ScriptShotView } from "@/lib/canvas/script-model";
import { generateEpisodeContent, generateShotContent, type ScriptCaller } from "@/lib/canvas/script-generation";
import { generateScriptStage } from "@/services/api/canvas-agent";
import { MINIMAX_H3_SIZES } from "@/services/api/models/video-minimax-h3-omni";
import { useScriptStore } from "@/stores/canvas/use-script-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasScriptState, type ScriptAsset, type ScriptAssetKind, type ScriptShot, type ScriptStoryboardEpisode } from "@/types/canvas";

type Props = {
    nodes: CanvasNodeData[];
    batch: { total: number; done: number; failed: number; running: boolean };
    onSync: () => void;
    onGenerate: (keys: string[]) => void;
    onStop: () => void;
    onUploadAsset: (key: string, file: File) => Promise<void>;
    onLocate: (key: string) => void;
};

type Selection = { kind: "asset" | "episode" | "shot"; key: string };

const ACCEPT: Record<ScriptAssetKind, string> = { character: "image/*", scene: "image/*", prop: "image/*", video: "video/*", audio: "audio/*" };
const KIND_ICON: Record<ScriptAssetKind, typeof ImageIcon> = { character: Users, scene: MapPin, prop: ImageIcon, video: Video, audio: Music };

/** 故事板视图：左侧五类资产 / 分集 / 镜头，右侧结构化编辑，下方批量工具栏。 */
export function CanvasStoryboardView({ nodes, batch, onSync, onGenerate, onStop, onUploadAsset, onLocate }: Props) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const data = useScriptStore((state) => state.data);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const view = useMemo(() => (data ? buildScriptProjectView(data) : { episodes: [], assets: [], shots: [] }), [data]);
    const nodeByKey = useMemo(() => {
        const map = new Map<string, CanvasNodeData>();
        nodes.forEach((node) => {
            const key = node.metadata?.scriptKey;
            if (key) map.set(key, node);
        });
        return map;
    }, [nodes]);

    const selected = useMemo(() => {
        if (!selection) return null;
        if (selection.kind === "asset") return view.assets.find((item) => item.key === selection.key) || null;
        if (selection.kind === "episode") return view.episodes.find((item) => item.key === selection.key) || null;
        return view.shots.find((item) => item.key === selection.key) || null;
    }, [selection, view]);

    const update = (patch: Partial<CanvasScriptState>) => {
        useScriptStore.getState().update(patch);
        onSync();
    };

    const callStage: ScriptCaller = async (stage, text, extra) => {
        const agent = useAgentStore.getState();
        if (!agent.connected || !agent.url.trim() || !agent.token.trim()) throw new Error(t("canvas.script.needAgent"));
        const current = useScriptStore.getState().data;
        return generateScriptStage(agent.url.trim(), agent.token.trim(), {
            stage,
            source: text,
            options: current?.options,
            setting: current?.setting,
            outline: current?.outline,
            script: current?.script,
            assets: current ? view.assets.map((asset) => `${SCRIPT_ASSET_KIND_LABEL[asset.kind]}：${asset.name}｜id=${asset.id}`).join("\n") : "",
            ...extra,
        });
    };

    const saveAsset = (next: ScriptAsset) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        update({ assets: current.assets.map((asset) => (asset.id === next.id ? next : asset)) });
        message.success(t("canvas.storyboard.saved"));
    };

    const saveEpisodeScript = (episode: ScriptEpisodeView, content: string) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        const next = replaceEpisodeBlock(current.script, episode.number, content);
        if (next === null) return message.error(t("canvas.storyboard.saveFailed"));
        update({ script: next });
        message.success(t("canvas.storyboard.saved"));
    };

    const saveShot = async (next: ScriptShot, episodeId: string) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        const errors = validateH3Shot(next, current.assets, current.options.orientation);
        if (errors.length) return message.error(errors.join("；"));
        update({
            storyboard: current.storyboard.map((episode) => (episode.id === episodeId ? { ...episode, shots: episode.shots.map((shot) => (shot.id === next.id ? next : shot)) } : episode)),
        });
        message.success(t("canvas.storyboard.saved"));
    };

    const replaceEpisode = (next: ScriptStoryboardEpisode) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        const exists = current.storyboard.some((episode) => episode.id === next.id);
        const storyboard = exists
            ? current.storyboard.map((episode) => (episode.id === next.id ? next : episode))
            : [...current.storyboard, next].sort((a, b) => a.number - b.number);
        update({ storyboard });
    };

    const regenerateEpisode = async (episode: ScriptEpisodeView) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        setBusy(true);
        try {
            replaceEpisode(await generateEpisodeContent({
                episode,
                episodeTotal: view.episodes.length,
                assets: current.assets,
                orientation: current.options.orientation,
                text: current.condensed || current.source,
                call: callStage,
            }));
            message.success(t("canvas.storyboard.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.script.failed"));
        } finally {
            setBusy(false);
        }
    };

    const regenerateShot = async (shot: ScriptShotView) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        const episode = view.episodes.find((item) => item.id === shot.episodeId);
        if (!episode) return message.error(t("canvas.storyboard.saveFailed"));
        setBusy(true);
        try {
            const next = await generateShotContent({
                episode,
                episodeTotal: view.episodes.length,
                shot,
                assets: current.assets,
                orientation: current.options.orientation,
                text: current.condensed || current.source,
                call: callStage,
            });
            update({
                storyboard: current.storyboard.map((item) => (item.id === episode.id ? { ...item, shots: item.shots.map((value) => (value.id === next.id ? next : value)) } : item)),
            });
            message.success(t("canvas.storyboard.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.script.failed"));
        } finally {
            setBusy(false);
        }
    };

    const keysOf = (kind: "asset" | "character" | "shot") =>
        (kind === "shot" ? view.shots.map((item) => item.key) : kind === "character" ? view.assets.filter((item) => item.kind === "character").map((item) => item.key) : view.assets.map((item) => item.key)).filter((key) => nodeByKey.get(key)?.metadata?.status !== "success");

    const statusOf = (key: string) => nodeByKey.get(key)?.metadata?.status;
    const statusDot = (key: string) => {
        const status = statusOf(key);
        const color = status === "success" ? theme.state.success : status === "error" ? theme.state.danger : status === "loading" ? theme.state.warning : theme.node.muted;
        return <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />;
    };

    const row = (key: string, label: string, meta?: string) => (
        <button
            key={key}
            type="button"
            onClick={() => setSelection(selection?.key === key ? null : { kind: key.startsWith("asset:") ? "asset" : key.startsWith("shot:") ? "shot" : "episode", key })}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
            style={{ background: selection?.key === key ? theme.toolbar.activeBg : undefined, color: theme.node.text }}
        >
            {statusDot(key)}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {meta ? <span className="shrink-0 text-[10px]" style={{ color: theme.node.muted }}>{meta}</span> : null}
        </button>
    );

    const accept = selection?.kind === "asset" ? ACCEPT[(selected as ScriptAssetView | null)?.kind || "character"] : "image/*";

    return (
        <section className="absolute inset-0 z-40 flex flex-col" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <div className="flex min-h-0 flex-1">
                <aside className="flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-r p-3" style={{ borderColor: theme.toolbar.border }}>
                    {!data ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.storyboard.loading")} /> : null}
                    {data && !view.assets.length && !view.episodes.length && !view.shots.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.storyboard.empty")} /> : null}

                    {SCRIPT_ASSET_KINDS.map((kind) => {
                        const list = view.assets.filter((item) => item.kind === kind);
                        if (!list.length) return null;
                        const Icon = KIND_ICON[kind];
                        return (
                            <div key={kind} className="space-y-1">
                                <div className="flex items-center gap-1 px-2 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                    <Icon className="size-3" />
                                    {t(`canvas.storyboard.kind.${kind}`)}
                                </div>
                                {list.map((asset) => row(asset.key, asset.name || t("canvas.storyboard.untitled")))}
                            </div>
                        );
                    })}

                    {view.episodes.length ? (
                        <div className="space-y-1">
                            <div className="px-2 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.storyboard.episodes")}</div>
                            {view.episodes.map((episode) => row(episode.key, episode.title, `第${episode.number}集`))}
                        </div>
                    ) : null}

                    {view.shots.length ? (
                        <div className="space-y-1">
                            <div className="px-2 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.storyboard.shots")}</div>
                            {view.shots.map((shot) => row(shot.key, shot.title || t("canvas.storyboard.untitled"), `#${shot.number}`))}
                        </div>
                    ) : null}
                </aside>

                <main className="min-w-0 flex-1 overflow-y-auto p-5">
                    {!selected ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.storyboard.selectHint")} />
                    ) : selection?.kind === "asset" ? (
                        <AssetEditor
                            key={selected.key}
                            asset={selected as ScriptAssetView}
                            node={nodeByKey.get(selected.key)}
                            disabled={busy}
                            onSave={saveAsset}
                            onRegenerate={() => onGenerate([selected.key])}
                            onUpload={() => fileRef.current?.click()}
                            onLocate={() => onLocate(selected.key)}
                        />
                    ) : selection?.kind === "episode" ? (
                        <EpisodeEditor
                            key={selected.key}
                            episode={selected as ScriptEpisodeView}
                            node={nodeByKey.get(selected.key)}
                            disabled={busy}
                            onSave={(content) => saveEpisodeScript(selected as ScriptEpisodeView, content)}
                            onRegenerate={() => void regenerateEpisode(selected as ScriptEpisodeView)}
                            onLocate={() => onLocate(selected.key)}
                        />
                    ) : (
                        <ShotEditor
                            key={selected.key}
                            shot={selected as ScriptShotView}
                            assets={view.assets}
                            orientation={data?.options.orientation}
                            node={nodeByKey.get(selected.key)}
                            disabled={busy}
                            isReady={(id) => Boolean(nodeByKey.get(`asset:${id}`)?.metadata?.content)}
                            onSave={(next) => void saveShot(next, (selected as ScriptShotView).episodeId)}
                            onRegenerate={() => void regenerateShot(selected as ScriptShotView)}
                            onGenerate={() => onGenerate([selected.key])}
                            onLocate={() => onLocate(selected.key)}
                        />
                    )}
                </main>
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                <Button size="small" type="text" icon={<ImageIcon className="size-4" />} onClick={() => onGenerate(keysOf("asset"))}>{t("canvas.storyboard.generateAssets")}</Button>
                <Button size="small" type="text" icon={<Users className="size-4" />} onClick={() => onGenerate(keysOf("character"))}>{t("canvas.storyboard.generateCharacters")}</Button>
                <Button size="small" type="text" icon={<Video className="size-4" />} onClick={() => onGenerate(keysOf("shot"))}>{t("canvas.storyboard.generateShots")}</Button>
                <Button size="small" type="text" icon={<Upload className="size-4" />} disabled={selection?.kind !== "asset"} onClick={() => fileRef.current?.click()}>{t("canvas.storyboard.upload")}</Button>
                {batch.running ? <Button size="small" type="text" icon={<Square className="size-4" />} onClick={onStop}>{t("canvas.storyboard.stop")}</Button> : null}
                <span className="ml-auto text-xs" style={{ color: theme.node.muted }}>
                    {batch.total ? t("canvas.storyboard.progress", { done: batch.done, total: batch.total, failed: batch.failed }) : t("canvas.storyboard.syncedHint", { count: nodes.filter((node) => node.metadata?.scriptKey).length })}
                </span>
            </footer>

            <input
                ref={fileRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (!file || selection?.kind !== "asset") return;
                    void onUploadAsset(selection.key, file);
                }}
            />
        </section>
    );
}

function AssetEditor({ asset, node, disabled, onSave, onRegenerate, onUpload, onLocate }: { asset: ScriptAssetView; node?: CanvasNodeData; disabled: boolean; onSave: (asset: ScriptAsset) => void; onRegenerate: () => void; onUpload: () => void; onLocate: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<ScriptAsset>(asset);
    const dirty = draft.name !== asset.name || draft.description !== asset.description || draft.prompt !== asset.prompt;
    return (
        <div className="space-y-3">
            <EditorHeader title={assetLabel(asset)} node={node} onLocate={onLocate} />
            <Field label={t("canvas.storyboard.assetName")}>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={t("canvas.storyboard.assetDescription")}>
                <Input.TextArea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} autoSize={{ minRows: 3, maxRows: 8 }} />
            </Field>
            <Field label={t("canvas.storyboard.assetPrompt")}>
                <Input.TextArea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} autoSize={{ minRows: 6, maxRows: 16 }} />
            </Field>
            <div className="flex gap-2">
                <Button size="small" disabled={disabled || !dirty || !draft.name.trim()} onClick={() => onSave(draft)}>{t("canvas.storyboard.save")}</Button>
                <Button size="small" type="text" icon={<Sparkles className="size-4" />} disabled={disabled} onClick={onRegenerate}>{t("canvas.storyboard.generate")}</Button>
                <Button size="small" type="text" icon={<Upload className="size-4" />} onClick={onUpload}>{t("canvas.storyboard.upload")}</Button>
            </div>
            <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.storyboard.assetHint")}</p>
        </div>
    );
}

function EpisodeEditor({ episode, node, disabled, onSave, onRegenerate, onLocate }: { episode: ScriptEpisodeView; node?: CanvasNodeData; disabled: boolean; onSave: (content: string) => void; onRegenerate: () => void; onLocate: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [content, setContent] = useState(episode.script || episode.outline);
    return (
        <div className="space-y-3">
            <EditorHeader title={episode.title || `第 ${episode.number} 集`} node={node} onLocate={onLocate} />
            <Input.TextArea value={content} onChange={(event) => setContent(event.target.value)} autoSize={{ minRows: 14, maxRows: 30 }} />
            <div className="flex gap-2">
                <Button size="small" disabled={disabled || content === episode.script} onClick={() => onSave(content)}>{t("canvas.storyboard.save")}</Button>
                <Button size="small" type="text" icon={<RefreshCw className="size-4" />} disabled={disabled} onClick={onRegenerate}>{t("canvas.storyboard.regenerate")}</Button>
            </div>
            <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.storyboard.episodeHint")}</p>
        </div>
    );
}

function ShotEditor({ shot, assets, orientation, node, disabled, isReady, onSave, onRegenerate, onGenerate, onLocate }: { shot: ScriptShotView; assets: ScriptAssetView[]; orientation?: "vertical" | "horizontal"; node?: CanvasNodeData; disabled: boolean; isReady: (id: string) => boolean; onSave: (shot: ScriptShot) => void; onRegenerate: () => void; onGenerate: () => void; onLocate: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<ScriptShot>(() => toShot(shot));
    const dirty = JSON.stringify(draft) !== JSON.stringify(toShot(shot));
    const errors = validateH3Shot(draft, assets, orientation);
    const missing = [...draft.imageAssetIds, ...draft.videoAssetIds, ...draft.audioAssetIds].filter((id) => !isReady(id));
    const sizeOptions = MINIMAX_H3_SIZES.filter((size) => {
        const [w, h] = size.split("x").map(Number);
        return orientation === "horizontal" ? w > h : h > w;
    }).map((size) => ({ value: size, label: `${size} · ${((w2(size) * h2(size)) / 1e6).toFixed(2)}MP` }));
    const patch = (value: Partial<ScriptShot>) => setDraft({ ...draft, ...value });

    return (
        <div className="space-y-3">
            <EditorHeader title={shot.title || t("canvas.storyboard.untitled")} node={node} onLocate={onLocate} />
            <div className="grid grid-cols-3 gap-3">
                <Field label={t("canvas.storyboard.shotTitle")}>
                    <Input value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
                </Field>
                <Field label={t("canvas.storyboard.shotDuration")}>
                    <InputNumber className="w-full" min={1} max={15} step={1} precision={0} value={draft.duration} onChange={(value) => patch({ duration: Number(value) || 0 })} />
                </Field>
                <Field label={t("canvas.storyboard.shotSize")}>
                    <Select className="w-full" value={draft.size} options={sizeOptions} onChange={(value) => patch({ size: value })} />
                </Field>
            </div>

            <ReferenceList
                label={t("canvas.storyboard.referenceImages")}
                limit={SCRIPT_SHOT_LIMITS.image}
                ids={draft.imageAssetIds}
                assets={assets.filter((asset) => asset.kind !== "video" && asset.kind !== "audio")}
                onChange={(ids) => patch({ imageAssetIds: ids })}
                labelOf={(id) => assets.find((asset) => asset.id === id) ? assetLabel(assets.find((asset) => asset.id === id)!) : t("canvas.storyboard.unknownAsset", { id: id.slice(0, 6) })}
                isReady={isReady}
            />
            <ReferenceList
                label={t("canvas.storyboard.referenceVideos")}
                limit={SCRIPT_SHOT_LIMITS.video}
                ids={draft.videoAssetIds}
                assets={assets.filter((asset) => asset.kind === "video")}
                onChange={(ids) => patch({ videoAssetIds: ids })}
                labelOf={(id) => assets.find((asset) => asset.id === id) ? assetLabel(assets.find((asset) => asset.id === id)!) : t("canvas.storyboard.unknownAsset", { id: id.slice(0, 6) })}
                isReady={isReady}
            />
            <ReferenceList
                label={t("canvas.storyboard.referenceAudios")}
                limit={SCRIPT_SHOT_LIMITS.audio}
                ids={draft.audioAssetIds}
                assets={assets.filter((asset) => asset.kind === "audio")}
                onChange={(ids) => patch({ audioAssetIds: ids })}
                labelOf={(id) => assets.find((asset) => asset.id === id) ? assetLabel(assets.find((asset) => asset.id === id)!) : t("canvas.storyboard.unknownAsset", { id: id.slice(0, 6) })}
                isReady={isReady}
            />

            {SCRIPT_H3_SECTIONS.map((section) => (
                <Field key={section} label={section}>
                    <Input.TextArea value={draft.h3[section]} onChange={(event) => patch({ h3: { ...draft.h3, [section]: event.target.value } })} autoSize={{ minRows: 3, maxRows: 12 }} />
                </Field>
            ))}

            {errors.length ? (
                <ul className="space-y-0.5 rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: theme.state.danger, color: theme.state.danger }}>
                    {errors.map((error) => <li key={error}>{error}</li>)}
                </ul>
            ) : null}
            {missing.length ? <p className="text-xs" style={{ color: theme.state.warning }}>{t("canvas.storyboard.referenceMissing", { count: missing.length })}</p> : null}

            <div className="flex gap-2">
                <Button size="small" disabled={disabled || !dirty || errors.length > 0} onClick={() => onSave(draft)}>{t("canvas.storyboard.save")}</Button>
                <Button size="small" type="text" icon={<RefreshCw className="size-4" />} disabled={disabled} onClick={onRegenerate}>{t("canvas.storyboard.regenerate")}</Button>
                <Tooltip title={errors.length ? t("canvas.storyboard.generateBlocked") : missing.length ? t("canvas.storyboard.referenceMissingTooltip") : ""}>
                    <Button size="small" type="text" icon={<Video className="size-4" />} disabled={disabled || errors.length > 0 || missing.length > 0} onClick={onGenerate}>{t("canvas.storyboard.generate")}</Button>
                </Tooltip>
            </div>
            <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.storyboard.shotHint")}</p>
        </div>
    );
}

function ReferenceList({ label, limit, ids, assets, onChange, labelOf, isReady }: { label: string; limit: number; ids: string[]; assets: ScriptAssetView[]; onChange: (ids: string[]) => void; labelOf: (id: string) => string; isReady: (id: string) => boolean }) {
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
                <Select
                    size="small"
                    className="w-[220px]"
                    value={null}
                    placeholder={t("canvas.storyboard.addReference")}
                    options={available}
                    disabled={ids.length >= limit}
                    onChange={(value: string) => onChange([...ids, value])}
                />
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

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-1">
            <span className="text-xs font-medium">{label}</span>
            {children}
        </label>
    );
}

function EditorHeader({ title, node, onLocate }: { title: string; node?: CanvasNodeData; onLocate: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="flex items-center gap-2">
            <Clapperboard className="size-4" />
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
            <span className="text-xs" style={{ color: theme.node.muted }}>{node ? (node.type === CanvasNodeType.Image ? t("canvas.storyboard.nodeImage") : node.type === CanvasNodeType.Video ? t("canvas.storyboard.nodeVideo") : node.type === CanvasNodeType.Audio ? t("canvas.storyboard.nodeAudio") : t("canvas.storyboard.nodeText")) : t("canvas.storyboard.noNode")}</span>
            <Tooltip title={t("canvas.storyboard.locate")}>
                <Button size="small" type="text" disabled={!node} icon={<MapPin className="size-4" />} onClick={onLocate} />
            </Tooltip>
        </div>
    );
}

function w2(size: string) {
    return Number(size.split("x")[0]) || 0;
}

function h2(size: string) {
    return Number(size.split("x")[1]) || 0;
}

/** 去掉视图附加字段，只保留纯镜头数据，避免把 key/episodeId 写回剧本。 */
function toShot(shot: ScriptShot): ScriptShot {
    return { id: shot.id, number: shot.number, title: shot.title, duration: shot.duration, size: shot.size, imageAssetIds: shot.imageAssetIds, videoAssetIds: shot.videoAssetIds, audioAssetIds: shot.audioAssetIds, h3: shot.h3 };
}
