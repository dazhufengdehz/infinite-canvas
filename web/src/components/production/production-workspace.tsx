import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { App, Button, Empty, Input, InputNumber, Segmented, Select } from "antd";
import { AlertCircle, ArrowLeft, Boxes, Check, Clapperboard, Download, Film, Play, Plus, RefreshCw, Sparkles, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { AssetEditor, ASSET_KIND_ICON, Field, MediaPreview, ShotEditor } from "@/components/production/production-editors";
import {
    assetLabel,
    assetUsages,
    createProductionAsset,
    createProductionEpisode,
    createProductionShot,
    formatAssetList,
    listShots,
    PRODUCTION_ASSET_KINDS,
    productionAssetKey,
    productionShotKey,
    serializeOutline,
    splitNovelChapters,
    validateShot,
} from "@/lib/production/production-model";
import { generateAssets, generateEpisodeScript, generateEpisodeStoryboard, generateAllStoryboards, generateOutline, generateSetting, generateShot, type ProductionCaller } from "@/lib/production/production-generation";
import { generateScriptStage, type ScriptAdaptRequest } from "@/services/api/canvas-agent";
import { useProductionStore } from "@/stores/canvas/use-production-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { type CanvasNodeData, type ProductionEpisode, type ProductionState, type ScriptAsset, type ScriptAssetKind, type ScriptShot } from "@/types/canvas";

type Stage = "source" | "setting" | "outline" | "script" | "assets" | "storyboard" | "shots";

type Props = {
    projectId: string;
    canvasId: string;
    title: string;
    nodes: CanvasNodeData[];
    batch: { total: number; done: number; failed: number; running: boolean; phase: string };
    onSync: () => void;
    onGenerate: (keys: string[]) => void;
    onProduce: () => void;
    onStop: () => void;
    onUploadAsset: (key: string, file: File) => Promise<void>;
    onLocate: (key: string) => void;
    onOpenCanvas: () => void;
};

const STAGES: Stage[] = ["source", "setting", "outline", "script", "assets", "storyboard", "shots"];
const CONDENSE_TRIGGER = 20000;

export function ProductionWorkspace({ projectId, canvasId, title, nodes, batch, onSync, onGenerate, onProduce, onStop, onUploadAsset, onLocate, onOpenCanvas }: Props) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const data = useProductionStore((state) => state.data);
    const loading = useProductionStore((state) => state.loading);
    const saving = useProductionStore((state) => state.saving);
    const storeError = useProductionStore((state) => state.error);
    const [stage, setStage] = useState<Stage>("source");
    const [episodeId, setEpisodeId] = useState<string>("");
    const [assetId, setAssetId] = useState<string>("");
    const [shotId, setShotId] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [chapters, setChapters] = useState<Set<number>>(new Set());
    const [uploadTarget, setUploadTarget] = useState<string>("");
    const fileRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        void useProductionStore.getState().load(projectId, canvasId);
    }, [projectId, canvasId]);

    useEffect(() => {
        if (storeError) message.error(storeError);
    }, [storeError, message]);

    const nodeByKey = useMemo(() => {
        const map = new Map<string, CanvasNodeData>();
        nodes.forEach((node) => {
            const key = node.metadata?.scriptKey;
            if (key) map.set(key, node);
        });
        return map;
    }, [nodes]);

    const shots = useMemo(() => (data ? listShots(data) : []), [data]);
    const selectedEpisode = data?.episodes.find((episode) => episode.id === episodeId) || data?.episodes[0];
    const selectedAsset = data?.assets.find((asset) => asset.id === assetId);
    const selectedShot = shots.find((shot) => shot.id === shotId);

    const patch = (value: Partial<ProductionState>, sync = false) => {
        useProductionStore.getState().update(value);
        if (sync) onSync();
    };

    const updateEpisode = (id: string, value: Partial<ProductionEpisode>, sync = true) => {
        if (!data) return;
        patch({ episodes: data.episodes.map((episode) => (episode.id === id ? { ...episode, ...value } : episode)) }, sync);
    };

    const updateShot = (id: string, next: ScriptShot) => {
        if (!data) return;
        patch({ episodes: data.episodes.map((episode) => ({ ...episode, shots: episode.shots.map((shot) => (shot.id === id ? next : shot)) })) }, true);
    };

    const callStage: ProductionCaller = async (nextStage, text, extra) => {
        const agent = useAgentStore.getState();
        if (!agent.connected || !agent.url.trim() || !agent.token.trim()) throw new Error(t("canvas.script.needAgent"));
        const current = useProductionStore.getState().data;
        return generateScriptStage(agent.url.trim(), agent.token.trim(), {
            stage: nextStage,
            source: text,
            options: current?.options,
            setting: current?.setting,
            outline: current ? serializeOutline(current.episodes) : "",
            script: current ? current.episodes.map((episode) => episode.script).filter(Boolean).join("\n\n") : "",
            assets: current ? formatAssetList(current.assets) : "",
            ...(extra as Partial<ScriptAdaptRequest>),
        });
    };

    const run = async (label: string, task: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        setProgress(label);
        try {
            await task();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.production.failed"));
        } finally {
            setBusy(false);
            setProgress("");
        }
    };

    const ensureCondensed = async (text: string) => {
        if (text.length <= CONDENSE_TRIGGER) return text;
        setProgress(t("canvas.production.condensing"));
        return callStage("condense", text);
    };

    const doGenerateSetting = () =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            if (!data.source.text.trim()) throw new Error(t("canvas.production.emptySource"));
            const condensed = await ensureCondensed(data.source.text);
            const setting = await generateSetting({ text: condensed || data.source.text, call: callStage });
            patch({ setting, source: { ...data.source, condensed } }, true);
            setStage("setting");
        });

    const doGenerateOutline = () =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            if (!data.setting.trim()) throw new Error(t("canvas.production.emptySetting"));
            const parsed = await generateOutline({ text: data.source.condensed || data.source.text, setting: data.setting, call: callStage });
            const episodes = parsed.map((item, index) => {
                const existing = data.episodes[index];
                return existing ? { ...existing, number: index + 1, title: item.title, synopsis: item.synopsis } : createProductionEpisode(index + 1, item.title);
            });
            patch({ episodes }, true);
            setStage("outline");
        });

    const doGenerateScript = (episode: ProductionEpisode) =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            const script = await generateEpisodeScript({ episode, episodes: data.episodes, setting: data.setting, text: data.source.condensed || data.source.text, call: callStage });
            updateEpisode(episode.id, { script });
        });

    const doGenerateAssets = () =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            if (data.episodes.some((episode) => episode.shots.length)) throw new Error(t("canvas.production.assetsLocked"));
            const assets = await generateAssets({ text: data.source.condensed || data.source.text, setting: data.setting, episodes: data.episodes, call: callStage });
            patch({ assets }, true);
            setStage("assets");
        });

    const doGenerateEpisodeStoryboard = (episode: ProductionEpisode) =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            const result = await generateEpisodeStoryboard({ episode, episodes: data.episodes, assets: data.assets, orientation: data.options.orientation, text: data.source.condensed || data.source.text, setting: data.setting, call: callStage });
            updateEpisode(episode.id, { title: result.title, shots: result.shots });
        });

    const doGenerateAllStoryboards = () =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            if (!data.assets.length) throw new Error(t("canvas.production.needAssets"));
            const results = await generateAllStoryboards({
                episodes: data.episodes,
                assets: data.assets,
                orientation: data.options.orientation,
                text: data.source.condensed || data.source.text,
                setting: data.setting,
                call: callStage,
                onProgress: setProgress,
                progressLabel: (current, total) => t("canvas.production.episodeProgress").replace("{{current}}", String(current)).replace("{{total}}", String(total)),
            });
            patch({ episodes: data.episodes.map((episode) => {
                const result = results.find((item) => item.episodeId === episode.id);
                return result ? { ...episode, title: result.title, shots: result.shots } : episode;
            }) }, true);
            setStage("storyboard");
        });

    const doRegenerateShot = (shot: ScriptShot) =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            const episode = data.episodes.find((item) => item.shots.some((value) => value.id === shot.id));
            if (!episode) throw new Error(t("canvas.production.unknownShot"));
            const next = await generateShot({ episode, episodes: data.episodes, shot, assets: data.assets, orientation: data.options.orientation, text: data.source.condensed || data.source.text, setting: data.setting, call: callStage });
            updateShot(shot.id, next);
        });

    const keysOf = (kind: "asset" | "character" | "shot") => {
        const wanted = kind === "shot"
            ? shots.map((shot) => shot.key)
            : kind === "character"
              ? (data?.assets.filter((asset) => asset.kind === "character") || []).map((asset) => productionAssetKey(asset.id))
              : (data?.assets || []).map((asset) => productionAssetKey(asset.id));
        return wanted.filter((key) => nodeByKey.get(key)?.metadata?.status !== "success");
    };

    const statusDot = (key: string) => {
        const status = nodeByKey.get(key)?.metadata?.status;
        const color = status === "success" ? theme.state.success : status === "error" ? theme.state.danger : status === "loading" ? theme.state.warning : theme.node.muted;
        return <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />;
    };

    const applyChapters = () => {
        if (!data) return;
        const list = splitNovelChapters(data.source.text);
        const text = [...chapters].sort((a, b) => a - b).map((index) => list[index]?.content || "").join("\n\n").trim();
        if (!text) return message.warning(t("canvas.production.chapterEmpty"));
        patch({ source: { ...data.source, text } });
        setChapters(new Set());
    };

    const addAsset = (kind: ScriptAssetKind) => {
        if (!data) return;
        const asset = { ...createProductionAsset(kind), name: t(`canvas.production.kind.${kind}`) };
        patch({ assets: [...data.assets, asset] }, true);
        setAssetId(asset.id);
        setStage("assets");
    };

    const removeAsset = (asset: ScriptAsset) => {
        if (!data) return;
        patch({ assets: data.assets.filter((item) => item.id !== asset.id) }, true);
        setAssetId("");
    };

    const duplicateAsset = (asset: ScriptAsset) => {
        if (!data) return;
        const copy = { ...asset, id: `${asset.id}_copy_${Date.now().toString(36)}`, name: `${asset.name} ${t("canvas.production.copySuffix")}` };
        patch({ assets: [...data.assets, copy] }, true);
        setAssetId(copy.id);
    };

    const addEpisode = () => {
        if (!data) return;
        const number = data.episodes.length + 1;
        const episode = createProductionEpisode(number);
        patch({ episodes: [...data.episodes, episode] }, true);
        setEpisodeId(episode.id);
    };

    const removeEpisode = (id: string) => {
        if (!data) return;
        patch({ episodes: data.episodes.filter((episode) => episode.id !== id) }, true);
        setEpisodeId("");
    };

    const addShot = () => {
        if (!data || !selectedEpisode) return;
        const shot = { ...createProductionShot(data.options.orientation), number: selectedEpisode.shots.length + 1, title: t("canvas.production.shotFallback", { number: selectedEpisode.shots.length + 1 }) };
        updateEpisode(selectedEpisode.id, { shots: [...selectedEpisode.shots, shot] });
        setShotId(shot.id);
    };

    const removeShot = (id: string) => {
        if (!data) return;
        patch({ episodes: data.episodes.map((episode) => ({ ...episode, shots: episode.shots.filter((shot) => shot.id !== id) })) }, true);
        setShotId("");
    };

    const openUpload = (key: string) => {
        setUploadTarget(key);
        fileRef.current?.click();
    };

    const uploadAccept = (() => {
        const kind = selectedAsset?.kind;
        return kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "image/*";
    })();

    const isReady = (id: string) => Boolean(nodeByKey.get(productionAssetKey(id))?.metadata?.content);
    const stageLabel = (value: Stage) => t(`canvas.production.stage.${value}`);

    return (
        <section className="absolute inset-0 z-40 flex flex-col" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                <Button size="small" type="text" icon={<ArrowLeft className="size-4" />} onClick={onOpenCanvas}>{t("canvas.production.backCanvas")}</Button>
                <h1 className="max-w-[220px] truncate text-sm font-medium">{title || t("canvas.production.title")}</h1>
                <Segmented size="small" value={stage} options={STAGES.map((value) => ({ value, label: stageLabel(value) }))} onChange={(value) => setStage(value as Stage)} />
                <span className="ml-auto text-xs" style={{ color: theme.node.muted }}>
                    {saving ? t("canvas.production.saving") : storeError ? t("canvas.production.saveFailed") : t("canvas.production.saved")}
                </span>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside className="flex w-[260px] shrink-0 flex-col gap-2 overflow-y-auto border-r p-3" style={{ borderColor: theme.toolbar.border }}>
                    {!data ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? t("canvas.production.loading") : t("canvas.production.empty")} /> : null}
                    {data ? <SideNav stage={stage} data={data} shots={shots} episodeId={selectedEpisode?.id || ""} assetId={assetId} shotId={shotId} nodeByKey={nodeByKey} onEpisode={setEpisodeId} onAsset={setAssetId} onShot={(id) => { setShotId(id); setStage("storyboard"); }} onAddAsset={addAsset} onAddEpisode={addEpisode} onRemoveEpisode={removeEpisode} statusDot={statusDot} /> : null}
                </aside>

                <main className="min-w-0 flex-1 overflow-y-auto p-5">
                    {!data ? null : stage === "source" ? (
                        <SourceStage data={data} chapters={chapters} onChapters={setChapters} onApplyChapters={applyChapters} onChange={(value) => patch({ source: { ...data.source, text: value } })} onOptions={(value) => patch({ options: { ...data.options, ...value } })} onGenerate={doGenerateSetting} busy={busy} />
                    ) : stage === "setting" ? (
                        <SettingStage value={data.setting} onChange={(value) => patch({ setting: value })} onBlur={onSync} onGenerate={doGenerateSetting} busy={busy} />
                    ) : stage === "outline" ? (
                        <OutlineStage data={data} onChange={(episodes) => patch({ episodes })} onSelect={setEpisodeId} onRemove={removeEpisode} onAdd={addEpisode} onGenerate={doGenerateOutline} onScript={(episode) => { setEpisodeId(episode.id); setStage("script"); }} busy={busy} />
                    ) : stage === "script" ? (
                        <ScriptStage data={data} episode={selectedEpisode} onChange={(value) => selectedEpisode && updateEpisode(selectedEpisode.id, { script: value }, false)} onBlur={onSync} onGenerate={(episode) => void doGenerateScript(episode)} busy={busy} />
                    ) : stage === "assets" ? (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                {PRODUCTION_ASSET_KINDS.map((kind) => (
                                    <Button key={kind} size="small" icon={<Plus className="size-4" />} onClick={() => addAsset(kind)}>{t(`canvas.production.kind.${kind}`)}</Button>
                                ))}
                                <Button size="small" type="primary" icon={<Sparkles className="size-4" />} disabled={busy} onClick={doGenerateAssets}>{t("canvas.production.generateAssets")}</Button>
                            </div>
                            {selectedAsset ? (
                                <AssetEditor
                                    key={selectedAsset.id}
                                    asset={selectedAsset}
                                    node={nodeByKey.get(productionAssetKey(selectedAsset.id))}
                                    disabled={busy}
                                    usages={data ? assetUsages(data, selectedAsset.id) : []}
                                    onSave={(next) => { patch({ assets: data.assets.map((asset) => (asset.id === next.id ? next : asset)) }, true); message.success(t("canvas.production.saved")); }}
                                    onGenerate={() => onGenerate([productionAssetKey(selectedAsset.id)])}
                                    onUpload={() => openUpload(productionAssetKey(selectedAsset.id))}
                                    onDuplicate={() => duplicateAsset(selectedAsset)}
                                    onRemove={() => removeAsset(selectedAsset)}
                                    onLocate={() => onLocate(productionAssetKey(selectedAsset.id))}
                                />
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.production.selectAsset")} />}
                        </div>
                    ) : stage === "storyboard" ? (
                        <StoryboardStage data={data} episode={selectedEpisode} shots={shots} selectedShot={selectedShot} onSelectEpisode={setEpisodeId} onSelectShot={setShotId} onAddShot={addShot} onRemoveShot={removeShot} onGenerateEpisode={(episode) => void doGenerateEpisodeStoryboard(episode)} onGenerateAll={doGenerateAllStoryboards} onSaveShot={(next) => updateShot(next.id, next)} onRegenerate={(shot) => void doRegenerateShot(shot)} onGenerateShot={(shot) => onGenerate([productionShotKey(shot.id)])} onLocate={(id) => onLocate(productionShotKey(id))} isReady={isReady} nodeByKey={nodeByKey} busy={busy} />
                    ) : (
                        <ShotsStage data={data} shots={shots} nodeByKey={nodeByKey} onRegenerate={(shot) => void doRegenerateShot(shot)} onGenerate={(shot) => onGenerate([productionShotKey(shot.id)])} onLocate={(id) => onLocate(productionShotKey(id))} onEdit={(id) => { setShotId(id); setStage("storyboard"); }} />
                    )}
                </main>

                <aside className="hidden w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-3 lg:flex" style={{ borderColor: theme.toolbar.border }}>
                    <Inspector data={data} shots={shots} selectedShot={selectedShot} selectedAsset={selectedAsset} nodeByKey={nodeByKey} isReady={isReady} />
                </aside>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                <Button size="small" type="text" icon={<Clapperboard className="size-4" />} disabled={batch.running || !data?.assets.length || !shots.length} onClick={onProduce}>{t("canvas.production.produce")}</Button>
                <Button size="small" type="text" icon={<Boxes className="size-4" />} onClick={() => onGenerate(keysOf("asset"))}>{t("canvas.production.generateAllAssets")}</Button>
                <Button size="small" type="text" icon={<Sparkles className="size-4" />} onClick={() => onGenerate(keysOf("character"))}>{t("canvas.production.generateCharacters")}</Button>
                <Button size="small" type="text" icon={<Film className="size-4" />} onClick={() => onGenerate(keysOf("shot"))}>{t("canvas.production.generateAllShots")}</Button>
                {batch.running ? <Button size="small" type="text" icon={<Square className="size-4" />} onClick={onStop}>{t("canvas.production.stop")}</Button> : null}
                <span className="ml-auto text-xs" style={{ color: theme.node.muted }}>
                    {progress || (batch.total ? t("canvas.production.progress").replace("{{done}}", String(batch.done)).replace("{{total}}", String(batch.total)).replace("{{failed}}", String(batch.failed)) : t("canvas.production.synced").replace("{{count}}", String(nodes.filter((node) => node.metadata?.scriptKey).length)))}
                </span>
            </footer>

            <input
                ref={fileRef}
                type="file"
                accept={uploadAccept}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    const key = uploadTarget;
                    setUploadTarget("");
                    if (!file || !key) return;
                    void onUploadAsset(key, file);
                }}
            />
        </section>
    );
}

function SideNav({ stage, data, shots, episodeId, assetId, shotId, nodeByKey, onEpisode, onAsset, onShot, onAddAsset, onAddEpisode, onRemoveEpisode, statusDot }: {
    stage: Stage;
    data: ProductionState;
    shots: ReturnType<typeof listShots>;
    episodeId: string;
    assetId: string;
    shotId: string;
    nodeByKey: Map<string, CanvasNodeData>;
    onEpisode: (id: string) => void;
    onAsset: (id: string) => void;
    onShot: (id: string) => void;
    onAddAsset: (kind: ScriptAssetKind) => void;
    onAddEpisode: () => void;
    onRemoveEpisode: (id: string) => void;
    statusDot: (key: string) => ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    if (stage === "assets") {
        return (
            <>
                {PRODUCTION_ASSET_KINDS.map((kind) => {
                    const Icon = ASSET_KIND_ICON[kind];
                    const list = data.assets.filter((asset) => asset.kind === kind);
                    return (
                        <div key={kind} className="space-y-1">
                            <div className="flex items-center gap-1 px-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                <Icon className="size-3" />
                                <span className="min-w-0 flex-1 truncate">{t(`canvas.production.kind.${kind}`)}</span>
                                <button type="button" className="grid size-5 place-items-center rounded hover:bg-surface-hover" onClick={() => onAddAsset(kind)}><Plus className="size-3" /></button>
                            </div>
                            {list.map((asset) => (
                                <button key={asset.id} type="button" onClick={() => onAsset(asset.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-hover" style={{ background: assetId === asset.id ? theme.toolbar.activeBg : undefined }}>
                                    {statusDot(productionAssetKey(asset.id))}
                                    <span className="min-w-0 flex-1 truncate">{asset.name || t("canvas.production.untitled")}</span>
                                </button>
                            ))}
                            {!list.length ? <p className="px-2 text-[10px] italic opacity-40">{t("canvas.production.emptyKind")}</p> : null}
                        </div>
                    );
                })}
            </>
        );
    }
    if (stage === "storyboard" || stage === "shots") {
        return (
            <>
                {data.episodes.map((episode) => (
                    <div key={episode.id} className="space-y-1">
                        <button type="button" onClick={() => onEpisode(episode.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-hover" style={{ background: episodeId === episode.id ? theme.toolbar.activeBg : undefined }}>
                            <span className="min-w-0 flex-1 truncate">{episode.title || t("canvas.production.episodeFallback", { number: episode.number })}</span>
                            <span className="text-[10px]" style={{ color: theme.node.muted }}>{episode.shots.length}</span>
                        </button>
                        {episode.shots.map((shot) => (
                            <button key={shot.id} type="button" onClick={() => onShot(shot.id)} className="flex w-full items-center gap-2 rounded-lg py-1 pl-5 pr-2 text-left text-[11px] hover:bg-surface-hover" style={{ background: shotId === shot.id ? theme.toolbar.activeBg : undefined }}>
                                {statusDot(productionShotKey(shot.id))}
                                <span className="min-w-0 flex-1 truncate">{shot.title || t("canvas.production.untitled")}</span>
                                <span style={{ color: theme.node.muted }}>#{shot.number}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </>
        );
    }
    return (
        <>
            <div className="px-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.production.episodes")}</div>
            {data.episodes.map((episode) => (
                <div key={episode.id} className="flex items-center gap-1">
                    <button type="button" onClick={() => onEpisode(episode.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-hover" style={{ background: episodeId === episode.id ? theme.toolbar.activeBg : undefined }}>
                        <span className="min-w-0 flex-1 truncate">{episode.title || t("canvas.production.episodeFallback", { number: episode.number })}</span>
                        {episode.script.trim() ? <Check className="size-3" style={{ color: theme.state.success }} /> : null}
                    </button>
                    <button type="button" className="grid size-6 shrink-0 place-items-center rounded text-[10px] opacity-50 hover:bg-surface-hover" onClick={() => onRemoveEpisode(episode.id)}>×</button>
                </div>
            ))}
            <Button size="small" type="dashed" icon={<Plus className="size-3.5" />} onClick={onAddEpisode}>{t("canvas.production.addEpisode")}</Button>
            {shots.length ? <p className="px-1 pt-2 text-[10px]" style={{ color: theme.node.muted }}>{t("canvas.production.shotCount").replace("{{count}}", String(shots.length))}</p> : null}
        </>
    );
}

function SourceStage({ data, chapters, onChapters, onApplyChapters, onChange, onOptions, onGenerate, busy }: {
    data: ProductionState;
    chapters: Set<number>;
    onChapters: (value: Set<number>) => void;
    onApplyChapters: () => void;
    onChange: (value: string) => void;
    onOptions: (value: Partial<ProductionState["options"]>) => void;
    onGenerate: () => void;
    busy: boolean;
}) {
    const { t } = useTranslation();
    const list = splitNovelChapters(data.source.text);
    return (
        <div className="space-y-4">
            <Field label={t("canvas.production.sourceLabel")}>
                <Input.TextArea value={data.source.text} onChange={(event) => onChange(event.target.value)} rows={14} placeholder={t("canvas.production.sourcePlaceholder")} />
            </Field>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label={t("canvas.production.episodeCount")}><InputNumber className="w-full" min={1} max={100} value={data.options.episodes} onChange={(value) => onOptions({ episodes: Number(value) || 1 })} /></Field>
                <Field label={t("canvas.production.duration")}><InputNumber className="w-full" min={15} max={600} value={data.options.duration} onChange={(value) => onOptions({ duration: Number(value) || 60 })} /></Field>
                <Field label={t("canvas.production.orientation")}><Select className="w-full" value={data.options.orientation} options={[{ value: "vertical", label: t("canvas.production.vertical") }, { value: "horizontal", label: t("canvas.production.horizontal") }]} onChange={(value) => onOptions({ orientation: value })} /></Field>
                <Field label={t("canvas.production.genre")}><Input value={data.options.genre} onChange={(event) => onOptions({ genre: event.target.value })} /></Field>
            </div>
            {list.length > 1 ? (
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium">
                        <span>{t("canvas.production.chapters")}</span>
                        <Button size="small" type="text" onClick={onApplyChapters}>{t("canvas.production.useChapters")}</Button>
                    </div>
                    <div className="max-h-[160px] space-y-1 overflow-y-auto">
                        {list.map((chapter, index) => (
                            <label key={`${chapter.title}-${index}`} className="flex items-center gap-2 text-xs">
                                <input type="checkbox" checked={chapters.has(index)} onChange={(event) => { const next = new Set(chapters); if (event.target.checked) next.add(index); else next.delete(index); onChapters(next); }} />
                                <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                                <span className="text-[10px] opacity-50">{chapter.content.length}</span>
                            </label>
                        ))}
                    </div>
                </div>
            ) : null}
            <Button type="primary" icon={<Sparkles className="size-4" />} loading={busy} onClick={onGenerate}>{t("canvas.production.generateSetting")}</Button>
        </div>
    );
}

function SettingStage({ value, onChange, onBlur, onGenerate, busy }: { value: string; onChange: (value: string) => void; onBlur: () => void; onGenerate: () => void; busy: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="space-y-3">
            <Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} rows={22} placeholder={t("canvas.production.settingPlaceholder")} />
            <Button size="small" type="text" icon={<RefreshCw className="size-4" />} loading={busy} onClick={onGenerate}>{t("canvas.production.regenerate")}</Button>
        </div>
    );
}

function OutlineStage({ data, onChange, onSelect, onRemove, onAdd, onGenerate, onScript, busy }: {
    data: ProductionState;
    onChange: (episodes: ProductionEpisode[]) => void;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onAdd: () => void;
    onGenerate: () => void;
    onScript: (episode: ProductionEpisode) => void;
    busy: boolean;
}) {
    const { t } = useTranslation();
    const update = (id: string, value: Partial<ProductionEpisode>) => onChange(data.episodes.map((episode) => (episode.id === id ? { ...episode, ...value } : episode)));
    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Button size="small" type="primary" icon={<Sparkles className="size-4" />} loading={busy} onClick={onGenerate}>{t("canvas.production.generateOutline")}</Button>
                <Button size="small" icon={<Plus className="size-4" />} onClick={onAdd}>{t("canvas.production.addEpisode")}</Button>
            </div>
            {data.episodes.map((episode) => (
                <div key={episode.id} className="space-y-2 rounded-xl border p-3" style={{ borderColor: canvasThemes[useThemeStore.getState().theme].node.stroke }}>
                    <div className="flex items-center gap-2">
                        <span className="text-xs opacity-50">#{episode.number}</span>
                        <Input value={episode.title} onChange={(event) => update(episode.id, { title: event.target.value })} />
                        <Button size="small" type="text" onClick={() => onScript(episode)}>{t("canvas.production.writeScript")}</Button>
                        <Button size="small" type="text" danger onClick={() => onRemove(episode.id)}>{t("canvas.production.remove")}</Button>
                    </div>
                    <Input.TextArea value={episode.synopsis} onChange={(event) => update(episode.id, { synopsis: event.target.value })} onFocus={() => onSelect(episode.id)} autoSize={{ minRows: 3, maxRows: 10 }} placeholder={t("canvas.production.synopsisPlaceholder")} />
                </div>
            ))}
            {!data.episodes.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.production.noOutline")} /> : null}
        </div>
    );
}

function ScriptStage({ data, episode, onChange, onBlur, onGenerate, busy }: { data: ProductionState; episode?: ProductionEpisode; onChange: (value: string) => void; onBlur: () => void; onGenerate: (episode: ProductionEpisode) => void; busy: boolean }) {
    const { t } = useTranslation();
    if (!episode) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.production.selectEpisode")} />;
    return (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
                <div className="text-xs font-medium">{t("canvas.production.episodeOutline")}</div>
                <p className="whitespace-pre-wrap rounded-lg border p-2 text-xs leading-5" style={{ borderColor: canvasThemes[useThemeStore.getState().theme].node.stroke }}>{episode.synopsis || t("canvas.production.emptySynopsis")}</p>
                <div className="text-[11px] opacity-60">{t("canvas.production.totalEpisodes").replace("{{count}}", String(data.episodes.length))}</div>
            </div>
            <div className="space-y-2">
                <Input.TextArea value={episode.script} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} rows={22} placeholder={t("canvas.production.scriptPlaceholder")} />
                <Button size="small" type="text" icon={<RefreshCw className="size-4" />} loading={busy} onClick={() => onGenerate(episode)}>{t("canvas.production.regenerateEpisode")}</Button>
            </div>
        </div>
    );
}

function StoryboardStage({ data, episode, shots, selectedShot, onSelectEpisode, onSelectShot, onAddShot, onRemoveShot, onGenerateEpisode, onGenerateAll, onSaveShot, onRegenerate, onGenerateShot, onLocate, isReady, nodeByKey, busy }: {
    data: ProductionState;
    episode?: ProductionEpisode;
    shots: ReturnType<typeof listShots>;
    selectedShot?: ReturnType<typeof listShots>[number];
    onSelectEpisode: (id: string) => void;
    onSelectShot: (id: string) => void;
    onAddShot: () => void;
    onRemoveShot: (id: string) => void;
    onGenerateEpisode: (episode: ProductionEpisode) => void;
    onGenerateAll: () => void;
    onSaveShot: (next: ScriptShot) => void;
    onRegenerate: (shot: ScriptShot) => void;
    onGenerateShot: (shot: ScriptShot) => void;
    onLocate: (id: string) => void;
    isReady: (id: string) => boolean;
    nodeByKey: Map<string, CanvasNodeData>;
    busy: boolean;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Select size="small" className="w-[220px]" value={episode?.id} options={data.episodes.map((item) => ({ value: item.id, label: item.title || t("canvas.production.episodeFallback", { number: item.number }) }))} onChange={onSelectEpisode} />
                <Button size="small" type="primary" icon={<Sparkles className="size-4" />} disabled={!episode || busy} onClick={() => episode && onGenerateEpisode(episode)}>{t("canvas.production.generateEpisodeStoryboard")}</Button>
                <Button size="small" icon={<Sparkles className="size-4" />} disabled={busy || !data.episodes.length} onClick={onGenerateAll}>{t("canvas.production.generateAllStoryboards")}</Button>
                <Button size="small" icon={<Plus className="size-4" />} disabled={!episode} onClick={onAddShot}>{t("canvas.production.addShot")}</Button>
            </div>
            {selectedShot ? (
                <div className="space-y-2">
                    <ShotEditor
                        key={selectedShot.key}
                        shot={selectedShot}
                        assets={data.assets}
                        orientation={data.options.orientation}
                        node={nodeByKey.get(selectedShot.key)}
                        disabled={busy}
                        isReady={isReady}
                        onSave={onSaveShot}
                        onRegenerate={() => onRegenerate(selectedShot)}
                        onGenerate={() => onGenerateShot(selectedShot)}
                        onLocate={() => onLocate(selectedShot.id)}
                    />
                    <Button size="small" type="text" danger onClick={() => onRemoveShot(selectedShot.id)}>{t("canvas.production.removeShot")}</Button>
                </div>
            ) : episode ? (
                <div className="space-y-2">
                    {episode.shots.map((shot) => {
                        const view = shots.find((item) => item.id === shot.id);
                        const errors = validateShot(shot, data.assets, data.options.orientation);
                        return (
                            <button key={shot.id} type="button" onClick={() => onSelectShot(shot.id)} className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs hover:bg-surface-hover" style={{ borderColor: theme.node.stroke }}>
                                <span className="opacity-50">#{shot.number}</span>
                                <span className="min-w-0 flex-1 truncate">{shot.title || t("canvas.production.untitled")}</span>
                                <span style={{ color: theme.node.muted }}>{shot.duration}s</span>
                                {errors.length ? <AlertCircle className="size-3.5" style={{ color: theme.state.danger }} /> : <Check className="size-3.5" style={{ color: theme.state.success }} />}
                                <span className="text-[10px]" style={{ color: theme.node.muted }}>{view ? nodeByKey.get(view.key)?.metadata?.status || "idle" : ""}</span>
                            </button>
                        );
                    })}
                    {!episode.shots.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.production.noShots")} /> : null}
                </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.production.selectEpisode")} />}
        </div>
    );
}

function ShotsStage({ data, shots, nodeByKey, onRegenerate, onGenerate, onLocate, onEdit }: {
    data: ProductionState;
    shots: ReturnType<typeof listShots>;
    nodeByKey: Map<string, CanvasNodeData>;
    onRegenerate: (shot: ScriptShot) => void;
    onGenerate: (shot: ScriptShot) => void;
    onLocate: (id: string) => void;
    onEdit: (id: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!shots.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.production.noOutput")} />;
    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shots.map((shot) => {
                const node = nodeByKey.get(shot.key);
                const content = node?.metadata?.content;
                const status = node?.metadata?.status || "idle";
                return (
                    <div key={shot.key} className="overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                        <div className="aspect-video bg-black/40">
                            {content ? <video className="size-full object-cover" src={content} controls preload="metadata" /> : <div className="grid size-full place-items-center text-xs" style={{ color: theme.node.muted }}>{status === "loading" ? t("canvas.production.generating") : status === "error" ? t("canvas.production.failed") : t("canvas.production.noOutputVideo")}</div>}
                        </div>
                        <div className="space-y-1 p-2">
                            <div className="flex items-center gap-2 text-xs">
                                <span className="min-w-0 flex-1 truncate">{shot.title || t("canvas.production.untitled")}</span>
                                <span style={{ color: theme.node.muted }}>{shot.duration}s</span>
                            </div>
                            <div className="text-[10px]" style={{ color: theme.node.muted }}>{t("canvas.production.shotMeta", { episode: shot.episodeNumber, number: shot.number, size: shot.size })}</div>
                            <div className="flex flex-wrap gap-1 pt-1">
                                <Button size="small" type="text" icon={<Play className="size-3.5" />} onClick={() => onGenerate(shot)}>{t("canvas.production.generate")}</Button>
                                <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} onClick={() => onRegenerate(shot)}>{t("canvas.production.regenerate")}</Button>
                                <Button size="small" type="text" icon={<Clapperboard className="size-3.5" />} onClick={() => onEdit(shot.id)}>{t("canvas.production.edit")}</Button>
                                <Button size="small" type="text" onClick={() => onLocate(shot.id)}>{t("canvas.production.locate")}</Button>
                                {content ? <a href={content} download className="inline-flex items-center px-1 text-xs opacity-70 hover:opacity-100"><Download className="size-3.5" /></a> : null}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Inspector({ data, shots, selectedShot, selectedAsset, nodeByKey, isReady }: {
    data?: ProductionState | null;
    shots: ReturnType<typeof listShots>;
    selectedShot?: ReturnType<typeof listShots>[number];
    selectedAsset?: ScriptAsset;
    nodeByKey: Map<string, CanvasNodeData>;
    isReady: (id: string) => boolean;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const ready = shots.filter((shot) => nodeByKey.get(shot.key)?.metadata?.status === "success").length;
    const errors = selectedShot && data ? validateShot(selectedShot, data.assets, data.options.orientation) : [];
    const missing = selectedShot ? [...selectedShot.imageAssetIds, ...selectedShot.videoAssetIds, ...selectedShot.audioAssetIds].filter((id) => !isReady(id)) : [];
    return (
        <>
            <div className="text-xs font-medium">{t("canvas.production.overview")}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label={t("canvas.production.episodes")} value={data?.episodes.length || 0} />
                <Stat label={t("canvas.production.assetsCount")} value={data?.assets.length || 0} />
                <Stat label={t("canvas.production.shotsCount")} value={shots.length} />
                <Stat label={t("canvas.production.readyCount")} value={ready} />
            </div>
            {selectedAsset ? (
                <div className="space-y-2">
                    <div className="text-xs font-medium">{assetLabel(selectedAsset)}</div>
                    <div className="h-[120px] overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                        <MediaPreview node={nodeByKey.get(productionAssetKey(selectedAsset.id))} kind={selectedAsset.kind} />
                    </div>
                    <p className="text-[11px]" style={{ color: theme.node.muted }}>{selectedAsset.description || t("canvas.production.noDescription")}</p>
                </div>
            ) : null}
            {selectedShot ? (
                <div className="space-y-2">
                    <div className="text-xs font-medium">{selectedShot.title || t("canvas.production.untitled")}</div>
                    {errors.length ? <ul className="space-y-0.5 text-[11px]" style={{ color: theme.state.danger }}>{errors.map((error) => <li key={error}>{error}</li>)}</ul> : <p className="text-[11px]" style={{ color: theme.state.success }}>{t("canvas.production.valid")}</p>}
                    {missing.length ? <p className="text-[11px]" style={{ color: theme.state.warning }}>{t("canvas.production.referenceMissing").replace("{{count}}", String(missing.length))}</p> : null}
                </div>
            ) : null}
            <div className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.production.inspectorHint")}</div>
        </>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border p-2" style={{ borderColor: "rgba(127,127,127,0.25)" }}>
            <div className="text-[10px] opacity-60">{label}</div>
            <div className="text-base font-semibold">{value}</div>
        </div>
    );
}
