import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { App, Button, Empty, Input, InputNumber, Segmented, Select, Switch } from "antd";
import { AlertCircle, ArrowLeft, ArrowRight, Boxes, Check, ChevronDown, ChevronUp, Clapperboard, Download, Film, Play, Plus, RefreshCw, Sparkles, Square, Workflow } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { AssetEditor, ASSET_KIND_ICON, Field, ShotEditor } from "@/components/production/production-editors";
import {
    assetUsages,
    assetVariants,
    createAssetVariant,
    createProductionAsset,
    createProductionEpisode,
    createProductionShot,
    formatAssetList,
    listShots,
    PRODUCTION_ASSET_KINDS,
    productionShotKey,
    serializeOutline,
    splitNovelChapters,
    validateShot,
} from "@/lib/production/production-model";
import { currentStage, deriveStageProgress, type StageAction, type StageProgress } from "@/lib/production/production-progress";
import { productionVariantKey } from "@/lib/production/production-nodes";
import { generateAssets, generateEpisodeScript, generateEpisodeStoryboard, generateAllStoryboards, generateOutline, generateSetting, generateShot, type ProductionCaller } from "@/lib/production/production-generation";
import { generateScriptStage, type ScriptAdaptRequest } from "@/services/api/canvas-agent";
import { useProductionStore } from "@/stores/canvas/use-production-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { getChannelWorkflows, useEffectiveConfig, type WorkflowCategory } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { PRODUCTION_PANEL_MAX_WIDTH, PRODUCTION_PANEL_MIN_WIDTH, PRODUCTION_PANEL_MOTION_MS, useProductionPanelStore } from "@/stores/use-production-panel-store";
import { type CanvasNodeData, type ProductionEpisode, type ProductionState, type ScriptAsset, type ScriptAssetKind, type ScriptAssetVariant, type ScriptShot } from "@/types/canvas";

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
    /** 上传角色音色参考：新建音频节点并记录到资产上。 */
    onUploadVoice: (assetId: string, file: File) => Promise<void>;
    onLocate: (key: string) => void;
    /** 画布连线是引用的唯一权威：工作台调整镜头引用时同步调整画布连线。 */
    onSetShotReferences: (shotId: string, refs: { imageVariantIds: string[]; videoAssetIds: string[]; audioAssetIds: string[] }) => void;
    /** 画布上已不属于当前生产数据的派生节点数量。 */
    orphanNodeCount: number;
    onCleanupOrphans: () => void;
};

const STAGES: Stage[] = ["source", "setting", "outline", "script", "assets", "storyboard", "shots"];
const CONDENSE_TRIGGER = 20000;
const PANEL_MOTION_SECONDS = PRODUCTION_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

export function ProductionWorkspace({ projectId, canvasId, title, nodes, batch, onSync, onGenerate, onProduce, onStop, onUploadAsset, onUploadVoice, onLocate, onSetShotReferences, orphanNodeCount, onCleanupOrphans }: Props) {
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
    const [variantId, setVariantId] = useState<string>("");
    /** 资产分类筛选：分类列表的当前选中项，空字符串表示全部。 */
    const [assetKind, setAssetKind] = useState<ScriptAssetKind | "">("");
    const [shotId, setShotId] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [chapters, setChapters] = useState<Set<number>>(new Set());
    const [uploadTarget, setUploadTarget] = useState<string>("");
    /** 音色上传目标：角色 ID。 */
    const [voiceTarget, setVoiceTarget] = useState<string>("");
    const [batchOpen, setBatchOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const width = useProductionPanelStore((state) => state.width);
    const panelOpen = useProductionPanelStore((state) => state.panelOpen);
    const panelMounted = useProductionPanelStore((state) => state.panelMounted);
    const panelClosing = useProductionPanelStore((state) => state.panelClosing);
    const setWidth = useProductionPanelStore((state) => state.setWidth);
    const closePanel = useProductionPanelStore((state) => state.closePanel);
    // Agent 面板也在画布右侧：同时打开时生产工作台让位，避免互相遮挡。
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const agentPanelWidth = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(PRODUCTION_PANEL_MAX_WIDTH, Math.max(PRODUCTION_PANEL_MIN_WIDTH, startWidth + startX - moveEvent.clientX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("production-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

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
    const selectedVariant = selectedAsset ? assetVariants(selectedAsset).find((variant) => variant.id === variantId) || assetVariants(selectedAsset)[0] : undefined;
    const selectedShot = shots.find((shot) => shot.id === shotId);

    /** 阶段进度与当前应处阶段：自动推导，用户可手动切换。 */
    const progressList = useMemo<StageProgress[]>(() => (data ? deriveStageProgress(data) : []), [data]);
    const autoStage = useMemo(() => (progressList.length ? currentStage(progressList) : "source"), [progressList]);
    // 下一步引导始终跟随自动推导的当前阶段，手动切换阶段只影响内容区。
    const stageProgress = progressList.find((item) => item.stage === autoStage);

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

    /** 工作台调整镜头引用：先同步画布连线，再回写生产态引用数组。 */
    const setShotReferences = (shotId: string, refs: { imageVariantIds: string[]; videoAssetIds: string[]; audioAssetIds: string[] }) => {
        if (!data) return;
        onSetShotReferences(shotId, refs);
        patch({ episodes: data.episodes.map((episode) => ({ ...episode, shots: episode.shots.map((shot) => (shot.id === shotId ? { ...shot, ...refs } : shot)) })) }, true);
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
            const { setting } = await generateSetting({ text: condensed || data.source.text, call: callStage });
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
                // 新建集必须带上梗概，否则多集时本集梗概会被静默丢弃。
                return existing ? { ...existing, number: index + 1, title: item.title, synopsis: item.synopsis } : createProductionEpisode(index + 1, item.title, item.synopsis);
            });
            patch({ episodes }, true);
            setStage("outline");
        });

    const doGenerateScript = (episode: ProductionEpisode) =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            const result = await generateEpisodeScript({ episode, episodes: data.episodes, setting: data.setting, text: data.source.condensed || data.source.text, call: callStage });
            updateEpisode(episode.id, { title: result.title, script: result.script });
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
            const result = await generateEpisodeStoryboard({
                episode,
                episodes: data.episodes,
                assets: data.assets,
                orientation: data.options.orientation,
                media: data.options,
                text: data.source.condensed || data.source.text,
                setting: data.setting,
                call: callStage,
                // 已解析的镜头先写回，校验失败也不会丢掉产出。
                onPartial: (shots) => updateEpisode(episode.id, { shots }, false),
            });
            updateEpisode(episode.id, { title: result.title, shots: result.shots });
            if (result.issues.length) message.warning(result.issues.join("\n"));
        });

    const doGenerateAllStoryboards = () =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            if (!data.assets.length) throw new Error(t("canvas.production.needAssets"));
            const results = await generateAllStoryboards({
                episodes: data.episodes,
                assets: data.assets,
                orientation: data.options.orientation,
                media: data.options,
                text: data.source.condensed || data.source.text,
                setting: data.setting,
                call: callStage,
                onProgress: setProgress,
                progressLabel: (current, total) => t("canvas.production.episodeProgress").replace("{{current}}", String(current)).replace("{{total}}", String(total)),
            });
            patch({
                episodes: data.episodes.map((episode) => {
                    const result = results.find((item) => item.episodeId === episode.id);
                    return result ? { ...episode, title: result.title, shots: result.shots } : episode;
                }),
            }, true);
            setStage("storyboard");
            const issues = results.flatMap((item) => item.issues);
            if (issues.length) message.warning(issues.join("\n"));
        });

    const doRegenerateShot = (shot: ScriptShot) =>
        run(t("canvas.production.generating"), async () => {
            if (!data) return;
            const episode = data.episodes.find((item) => item.shots.some((value) => value.id === shot.id));
            if (!episode) throw new Error(t("canvas.production.unknownShot"));
            const next = await generateShot({ episode, episodes: data.episodes, shot, assets: data.assets, orientation: data.options.orientation, media: data.options, text: data.source.condensed || data.source.text, setting: data.setting, call: callStage });
            updateShot(shot.id, next);
        });

    /** 下一步动作：直接执行当前阶段的下一步生成动作。 */
    const runNextAction = (action: StageAction) => {
        switch (action) {
            case "generateSetting":
                void doGenerateSetting();
                return;
            case "generateOutline":
                void doGenerateOutline();
                return;
            case "generateScript": {
                // 挑第一集还没正文的集直接写剧本。
                const target = data?.episodes.find((episode) => !episode.script.trim()) || data?.episodes[0];
                if (!target) return;
                setEpisodeId(target.id);
                setStage("script");
                void doGenerateScript(target);
                return;
            }
            case "generateAssets":
                void doGenerateAssets();
                return;
            case "generateStoryboard": {
                // 挑第一集还没有分镜的集直接生成分镜。
                const target = data?.episodes.find((episode) => !episode.shots.length) || data?.episodes[0];
                if (!target) return;
                setEpisodeId(target.id);
                setStage("storyboard");
                void doGenerateEpisodeStoryboard(target);
                return;
            }
            case "generateShots":
                setStage("shots");
                onGenerate(keysOf("shot"));
                return;
        }
    };

    const keysOf = (kind: "asset" | "character" | "shot") => {
        const wanted = kind === "shot"
            ? shots.map((shot) => shot.key)
            : kind === "character"
              ? (data?.assets || []).filter((asset) => asset.kind === "character").flatMap((asset) => assetVariants(asset).map((variant) => productionVariantKey(variant.id)))
              : (data?.assets || []).flatMap((asset) => assetVariants(asset).map((variant) => productionVariantKey(variant.id)));
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
        asset.variants = [createAssetVariant(asset)];
        patch({ assets: [...data.assets, asset] }, true);
        setAssetId(asset.id);
        setVariantId(asset.variants[0].id);
        setStage("assets");
    };

    const removeAsset = (asset: ScriptAsset) => {
        if (!data) return;
        patch({ assets: data.assets.filter((item) => item.id !== asset.id) }, true);
        setAssetId("");
        setVariantId("");
    };

    const duplicateAsset = (asset: ScriptAsset) => {
        if (!data) return;
        const copy = { ...asset, id: `${asset.id}_copy_${Date.now().toString(36)}`, name: `${asset.name} ${t("canvas.production.copySuffix")}`, variants: assetVariants(asset).map((variant) => ({ ...variant, id: `${variant.id}_copy_${Date.now().toString(36)}` })) };
        patch({ assets: [...data.assets, copy] }, true);
        setAssetId(copy.id);
        setVariantId(copy.variants[0]?.id || "");
    };

    /** 新增资产形态：每个形态独立对应一个画布节点。 */
    const addVariant = (asset: ScriptAsset) => {
        if (!data) return;
        const variant = createAssetVariant(asset);
        patch({ assets: data.assets.map((item) => (item.id === asset.id ? { ...item, variants: [...assetVariants(item), variant] } : item)) }, true);
        setVariantId(variant.id);
    };

    const removeVariant = (asset: ScriptAsset, targetId: string) => {
        if (!data) return;
        const variants = assetVariants(asset).filter((variant) => variant.id !== targetId);
        patch({ assets: data.assets.map((item) => (item.id === asset.id ? { ...item, variants } : item)) }, true);
        setVariantId(variants[0]?.id || "");
    };

    const saveVariant = (asset: ScriptAsset, variant: ScriptAssetVariant) => {
        if (!data) return;
        patch({ assets: data.assets.map((item) => (item.id === asset.id ? { ...item, variants: assetVariants(item).map((itemVariant) => (itemVariant.id === variant.id ? variant : itemVariant)) } : item)) }, true);
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
        if (voiceTarget) return "audio/*";
        return "image/*";
    })();

    const isReady = (id: string) => Boolean(nodeByKey.get(id)?.metadata?.content);
    const stageLabel = (value: Stage) => t(`canvas.production.stage.${value}`);

    if (!panelMounted) return null;

    return (
        <motion.div
            className="pointer-events-none absolute right-4 top-[76px] bottom-4 z-[65] flex justify-end"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 13 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined, marginRight: agentPanelOpen ? agentPanelWidth + 32 : 0 }}
        >
            <motion.aside
                className="pointer-events-auto relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border shadow-float backdrop-blur-xl"
                data-canvas-shortcuts-ignore
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.accent.chrome, borderColor: theme.hairline.base, color: theme.text.primary }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("canvas.production.resize")} />

                <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: theme.hairline.base }}>
                    <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title || t("canvas.production.title")}</h1>
                    <Button size="small" type="text" icon={<ArrowLeft className="size-4" />} onClick={closePanel} />
                </header>

                <StageProgressBar progress={progressList} stage={stage} autoStage={autoStage} onStage={setStage} />

                <div className="shrink-0 px-3 pb-2">
                    <Button
                        size="small"
                        type="primary"
                        block
                        icon={<ArrowRight className="size-4" />}
                        disabled={busy || !stageProgress || stageProgress.nextAction.disabled}
                        onClick={() => stageProgress && runNextAction(stageProgress.nextAction.action)}
                    >
                        {stageProgress?.nextAction.label || t("canvas.production.nextStep.title")}
                    </Button>
                    {stageProgress?.blockers.length ? (
                        <ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: theme.state.warning }}>
                            {stageProgress.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                        </ul>
                    ) : null}
                </div>

                <BatchSettings data={data} open={batchOpen} onToggle={() => setBatchOpen((value) => !value)} onChange={(value) => data && patch({ batch: value }, true)} />

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {!data ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? t("canvas.production.loading") : t("canvas.production.empty")} /> : null}
                    {data ? (
                        <div className="space-y-3 p-3">
                            <Segmented size="small" block value={stage} options={STAGES.map((value) => ({ value, label: stageLabel(value) }))} onChange={(value) => setStage(value as Stage)} />
                            {stage === "source" ? (
                                <SourceStage data={data} chapters={chapters} onChapters={setChapters} onApplyChapters={applyChapters} onChange={(value) => patch({ source: { ...data.source, text: value } })} onOptions={(value) => patch({ options: { ...data.options, ...value } }, true)} onGenerate={doGenerateSetting} busy={busy} />
                            ) : stage === "setting" ? (
                                <SettingStage value={data.setting} onChange={(value) => patch({ setting: value })} onBlur={onSync} onGenerate={doGenerateSetting} busy={busy} />
                            ) : stage === "outline" ? (
                                <OutlineStage data={data} onChange={(episodes) => patch({ episodes })} onSelect={setEpisodeId} onRemove={removeEpisode} onAdd={addEpisode} onGenerate={doGenerateOutline} onScript={(episode) => { setEpisodeId(episode.id); setStage("script"); }} busy={busy} />
                            ) : stage === "script" ? (
                                <ScriptStage data={data} episode={selectedEpisode} onChange={(value) => selectedEpisode && updateEpisode(selectedEpisode.id, { script: value }, false)} onBlur={onSync} onGenerate={(episode) => void doGenerateScript(episode)} busy={busy} />
                            ) : stage === "assets" ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button size="small" type="primary" icon={<Sparkles className="size-4" />} disabled={busy} onClick={doGenerateAssets}>{t("canvas.production.generateAssets")}</Button>
                                        <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.production.assetsHint")}</span>
                                    </div>
                                    <AssetGrid
                                        data={data}
                                        kind={assetKind}
                                        nodeByKey={nodeByKey}
                                        onSelect={(asset, variant) => {
                                            setAssetId(asset.id);
                                            setVariantId(variant.id);
                                        }}
                                        onAddAsset={addAsset}
                                    />
                                    {selectedAsset && selectedVariant ? (
                                        <div className="border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                                            <AssetEditor
                                                key={`${selectedAsset.id}:${selectedVariant.id}`}
                                                asset={selectedAsset}
                                                variant={selectedVariant}
                                                node={nodeByKey.get(productionVariantKey(selectedVariant.id))}
                                                voiceNode={selectedAsset.voiceNodeId ? nodes.find((node) => node.id === selectedAsset.voiceNodeId) : undefined}
                                                disabled={busy}
                                                usages={data ? assetUsages(data, selectedAsset.id) : []}
                                                onSave={(next) => { patch({ assets: data.assets.map((asset) => (asset.id === next.id ? next : asset)) }, true); message.success(t("canvas.production.saved")); }}
                                                onSaveVariant={(variant) => saveVariant(selectedAsset, variant)}
                                                onGenerate={() => onGenerate([productionVariantKey(selectedVariant.id)])}
                                                onUpload={() => openUpload(productionVariantKey(selectedVariant.id))}
                                                onUploadVoice={() => { setVoiceTarget(selectedAsset.id); fileRef.current?.click(); }}
                                                onAddVariant={() => addVariant(selectedAsset)}
                                                onRemoveVariant={(targetId) => removeVariant(selectedAsset, targetId)}
                                                onSelectVariant={setVariantId}
                                                onDuplicate={() => duplicateAsset(selectedAsset)}
                                                onRemove={() => removeAsset(selectedAsset)}
                                                onLocate={() => onLocate(productionVariantKey(selectedVariant.id))}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            ) : stage === "storyboard" ? (
                                <StoryboardStage data={data} episode={selectedEpisode} shots={shots} selectedShot={selectedShot} onSelectEpisode={setEpisodeId} onSelectShot={setShotId} onAddShot={addShot} onRemoveShot={removeShot} onGenerateEpisode={(episode) => void doGenerateEpisodeStoryboard(episode)} onGenerateAll={doGenerateAllStoryboards} onSaveShot={(next) => updateShot(next.id, next)} onRegenerate={(shot) => void doRegenerateShot(shot)} onGenerateShot={(shot) => onGenerate([productionShotKey(shot.id)])} onLocate={(id) => onLocate(productionShotKey(id))} isReady={isReady} nodeByKey={nodeByKey} busy={busy} onSetShotReferences={setShotReferences} orphanNodeCount={orphanNodeCount} onCleanupOrphans={onCleanupOrphans} />
                            ) : (
                                <ShotsStage data={data} shots={shots} nodeByKey={nodeByKey} onRegenerate={(shot) => void doRegenerateShot(shot)} onGenerate={(shot) => onGenerate([productionShotKey(shot.id)])} onLocate={(id) => onLocate(productionShotKey(id))} onEdit={(id) => { setShotId(id); setStage("storyboard"); }} />
                            )}
                        </div>
                    ) : null}
                </div>

                <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t px-3 py-2" style={{ borderColor: theme.hairline.base }}>
                    <Button size="small" type="text" icon={<Clapperboard className="size-4" />} disabled={batch.running || !data?.assets.length || !shots.length} onClick={onProduce}>{t("canvas.production.produce")}</Button>
                    <Button size="small" type="text" icon={<Boxes className="size-4" />} onClick={() => onGenerate(keysOf("asset"))}>{t("canvas.production.generateAllAssets")}</Button>
                    <Button size="small" type="text" icon={<Film className="size-4" />} onClick={() => onGenerate(keysOf("shot"))}>{t("canvas.production.generateAllShots")}</Button>
                    {batch.running ? <Button size="small" type="text" icon={<Square className="size-4" />} onClick={onStop}>{t("canvas.production.stop")}</Button> : null}
                    <span className="ml-auto text-[11px]" style={{ color: theme.node.muted }}>
                        {progress || (batch.total ? t("canvas.production.progress").replace("{{done}}", String(batch.done)).replace("{{total}}", String(batch.total)).replace("{{failed}}", String(batch.failed)) : saving ? t("canvas.production.saving") : storeError ? t("canvas.production.saveFailed") : t("canvas.production.saved"))}
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
                        const voice = voiceTarget;
                        const key = uploadTarget;
                        setUploadTarget("");
                        setVoiceTarget("");
                        if (!file) return;
                        if (voice) {
                            void onUploadVoice(voice, file);
                            return;
                        }
                        if (!key) return;
                        void onUploadAsset(key, file);
                    }}
                />
            </motion.aside>
        </motion.div>
    );
}

/** 阶段进度条：七个阶段节点、当前阶段高亮与产出数量标注。 */
function StageProgressBar({ progress, stage, autoStage, onStage }: {
    progress: StageProgress[];
    stage: Stage;
    autoStage: Stage;
    onStage: (stage: Stage) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!progress.length) return null;
    return (
        <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: theme.hairline.base }}>
            <div className="flex items-center gap-1">
                {progress.map((item) => {
                    const active = item.stage === stage;
                    const color = item.done ? theme.state.success : active ? theme.accent.base : theme.text.tertiary;
                    return (
                        <button
                            key={item.stage}
                            type="button"
                            onClick={() => onStage(item.stage)}
                            className="flex min-w-0 flex-1 flex-col items-center gap-1"
                            title={`${t(`canvas.production.stage.${item.stage}`)}${item.total ? ` ${item.count}/${item.total}` : item.count ? ` ${item.count}` : ""}`}
                        >
                            <span className="flex w-full items-center gap-1">
                                <span className="h-px flex-1" style={{ background: theme.hairline.base }} />
                                <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: active ? `0 0 0 2px ${theme.accent.soft}` : undefined }} />
                                <span className="h-px flex-1" style={{ background: theme.hairline.base }} />
                            </span>
                            <span className="w-full truncate text-center text-[10px]" style={{ color: active ? theme.text.primary : theme.text.tertiary }}>
                                {t(`canvas.production.stage.${item.stage}`)}
                            </span>
                            <span className="text-[10px] tabular-nums" style={{ color: theme.text.tertiary }}>
                                {item.total ? `${item.count}/${item.total}` : item.count}
                            </span>
                        </button>
                    );
                })}
            </div>
            {stage !== autoStage ? <p className="mt-1 text-center text-[10px]" style={{ color: theme.text.tertiary }}>{t("canvas.production.stageProgress.autoStage", { stage: t(`canvas.production.stage.${autoStage}`) })}</p> : null}
        </div>
    );
}

/** 批量生成设置：工作流选择与参数覆盖。 */
function BatchSettings({ data, open, onToggle, onChange }: {
    data: ProductionState | null;
    open: boolean;
    onToggle: () => void;
    onChange: (value: ProductionState["batch"]) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!data) return null;
    const batch = data.batch;
    const patch = (value: Partial<ProductionState["batch"]>) => onChange({ ...batch, ...value });
    return (
        <div className="shrink-0 border-b" style={{ borderColor: theme.hairline.base }}>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
                <Workflow className="size-3.5" />
                {t("canvas.production.batchSettings")}
                {open ? <ChevronUp className="ml-auto size-3.5" /> : <ChevronDown className="ml-auto size-3.5" />}
            </button>
            {open ? (
                <div className="space-y-2 px-3 pb-2">
                    <Field label={t("canvas.production.batch.assetWorkflow")}>
                        <WorkflowSelect
                            categories={["t2i", "i2i"]}
                            value={batch.assetWorkflowId}
                            placeholder={t("canvas.production.batch.useDefault")}
                            onChange={(value) => patch({ assetWorkflowId: value })}
                        />
                    </Field>
                    <Field label={t("canvas.production.batch.shotWorkflow")}>
                        <WorkflowSelect
                            categories={["omniVideo", "frameVideo"]}
                            value={batch.shotWorkflowId}
                            placeholder={t("canvas.production.batch.useDefault")}
                            onChange={(value) => patch({ shotWorkflowId: value })}
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                        <Field label={t("canvas.production.batch.assetSize")}>
                            <Input value={batch.assetSize} placeholder={t("canvas.production.batch.useNode")} onChange={(event) => patch({ assetSize: event.target.value.trim() })} />
                        </Field>
                        <Field label={t("canvas.production.batch.shotSeconds")}>
                            <InputNumber className="w-full" min={0} max={15} value={batch.shotSeconds} onChange={(value) => patch({ shotSeconds: Number(value) || 0 })} />
                        </Field>
                    </div>
                    <Field label={t("canvas.production.batch.seed")}>
                        <InputNumber className="w-full" min={-1} precision={0} value={batch.seed} onChange={(value) => patch({ seed: Number(value) })} />
                    </Field>
                    <p className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.production.batch.hint")}</p>
                </div>
            ) : null}
        </div>
    );
}

/** 工作流下拉：跨渠道列出指定分类的工作流，空值表示用渠道默认。 */
function WorkflowSelect({ categories, value, placeholder, onChange }: {
    categories: WorkflowCategory[];
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}) {
    const config = useEffectiveConfig();
    const options = useMemo(() => {
        const list = (config.channels || []).flatMap((channel) => getChannelWorkflows(channel, categories).map((wf) => ({ value: wf.id, label: `${wf.name}` })));
        return list;
    }, [config.channels, categories]);
    return <Select allowClear size="small" className="w-full" value={value || undefined} placeholder={placeholder} options={options} onChange={(next) => onChange(next || "")} />;
}

/** 资产缩略图网格：每个形态一张卡片，点击后在下方展开详情。 */
function AssetGrid({ data, kind, nodeByKey, onSelect, onAddAsset }: {
    data: ProductionState;
    kind: ScriptAssetKind | "";
    nodeByKey: Map<string, CanvasNodeData>;
    onSelect: (asset: ScriptAsset, variant: ScriptAssetVariant) => void;
    onAddAsset: (kind: ScriptAssetKind) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const assets = kind ? data.assets.filter((asset) => asset.kind === kind) : data.assets;
    const cards = assets.flatMap((asset) => assetVariants(asset).map((variant) => ({ asset, variant })));
    if (!cards.length) {
        return (
            <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("canvas.production.assetsEmpty")}
            >
                <div className="flex flex-wrap justify-center gap-2">
                    {PRODUCTION_ASSET_KINDS.map((item) => (
                        <Button key={item} size="small" icon={<Plus className="size-4" />} onClick={() => onAddAsset(item)}>
                            {t(`canvas.production.kind.${item}`)}
                        </Button>
                    ))}
                </div>
            </Empty>
        );
    }
    return (
        <div className="grid grid-cols-2 gap-2">
            {cards.map(({ asset, variant }) => {
                const node = nodeByKey.get(productionVariantKey(variant.id));
                const content = node?.metadata?.content;
                const status = node?.metadata?.status || "idle";
                return (
                    <button key={variant.id} type="button" onClick={() => onSelect(asset, variant)} className="group overflow-hidden rounded-xl border text-left transition hover:border-black/20 dark:hover:border-white/20" style={{ borderColor: theme.node.stroke }}>
                        <div className="aspect-square bg-black/40">
                            {content ? (
                                <img src={content} alt="" className="size-full object-cover" />
                            ) : (
                                <div className="grid size-full place-items-center">
                                    {status === "loading" ? (
                                        <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.production.generating")}</span>
                                    ) : (
                                        (() => {
                                            const Icon = ASSET_KIND_ICON[asset.kind] ?? Boxes;
                                            return <Icon className="size-6 opacity-25" />;
                                        })()
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="space-y-0.5 p-2">
                            <div className="truncate text-xs font-medium">{variant.name || asset.name || t("canvas.production.untitled")}</div>
                            <div className="truncate text-[10px]" style={{ color: theme.node.muted }}>
                                {asset.name !== variant.name ? `${asset.name} · ` : ""}
                                {t(`canvas.production.kind.${asset.kind}`)}
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
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
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const list = splitNovelChapters(data.source.text);
    return (
        <div className="space-y-3">
            <Field label={t("canvas.production.sourceLabel")}>
                <Input.TextArea value={data.source.text} onChange={(event) => onChange(event.target.value)} rows={12} placeholder={t("canvas.production.sourcePlaceholder")} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label={t("canvas.production.episodeCount")}><InputNumber className="w-full" min={1} max={100} value={data.options.episodes} onChange={(value) => onOptions({ episodes: Number(value) || 1 })} /></Field>
                <Field label={t("canvas.production.duration")}><InputNumber className="w-full" min={15} max={600} value={data.options.duration} onChange={(value) => onOptions({ duration: Number(value) || 60 })} /></Field>
                <Field label={t("canvas.production.orientation")}><Select className="w-full" value={data.options.orientation} options={[{ value: "vertical", label: t("canvas.production.vertical") }, { value: "horizontal", label: t("canvas.production.horizontal") }]} onChange={(value) => onOptions({ orientation: value })} /></Field>
                <Field label={t("canvas.production.genre")}><Input value={data.options.genre} onChange={(event) => onOptions({ genre: event.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2" style={{ borderColor: theme.node.stroke }}>
                <label className="flex items-center gap-1.5 text-xs">
                    <Switch size="small" checked={data.options.subtitle} onChange={(checked) => onOptions({ subtitle: checked })} />
                    {t("canvas.production.subtitle")}
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                    <Switch size="small" checked={data.options.bgm} onChange={(checked) => onOptions({ bgm: checked })} />
                    {t("canvas.production.bgm")}
                </label>
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
            <Button type="primary" block icon={<Sparkles className="size-4" />} loading={busy} onClick={onGenerate}>{t("canvas.production.generateSetting")}</Button>
        </div>
    );
}

function SettingStage({ value, onChange, onBlur, onGenerate, busy }: { value: string; onChange: (value: string) => void; onBlur: () => void; onGenerate: () => void; busy: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="space-y-2">
            <Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} rows={20} placeholder={t("canvas.production.settingPlaceholder")} />
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
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const update = (id: string, value: Partial<ProductionEpisode>) => onChange(data.episodes.map((episode) => (episode.id === id ? { ...episode, ...value } : episode)));
    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <Button size="small" type="primary" icon={<Sparkles className="size-4" />} loading={busy} onClick={onGenerate}>{t("canvas.production.generateOutline")}</Button>
                <Button size="small" icon={<Plus className="size-4" />} onClick={onAdd}>{t("canvas.production.addEpisode")}</Button>
            </div>
            {data.episodes.map((episode) => (
                <div key={episode.id} className="space-y-2 rounded-xl border p-2" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-center gap-1">
                        <span className="text-xs opacity-50">#{episode.number}</span>
                        <Input size="small" value={episode.title} onChange={(event) => update(episode.id, { title: event.target.value })} />
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
        <div className="space-y-2">
            <div className="text-xs font-medium">{t("canvas.production.episodeOutline")}</div>
            <p className="whitespace-pre-wrap rounded-lg border p-2 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>{episode.synopsis || t("canvas.production.emptySynopsis")}</p>
            <div className="text-[11px] opacity-60">{t("canvas.production.totalEpisodes").replace("{{count}}", String(data.episodes.length))}</div>
            <Input.TextArea value={episode.script} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} rows={18} placeholder={t("canvas.production.scriptPlaceholder")} />
            <Button size="small" type="text" icon={<RefreshCw className="size-4" />} loading={busy} onClick={() => onGenerate(episode)}>{t("canvas.production.regenerateEpisode")}</Button>
        </div>
    );
}

function StoryboardStage({ data, episode, shots, selectedShot, onSelectEpisode, onSelectShot, onAddShot, onRemoveShot, onGenerateEpisode, onGenerateAll, onSaveShot, onRegenerate, onGenerateShot, onLocate, isReady, nodeByKey, busy, onSetShotReferences, orphanNodeCount, onCleanupOrphans }: {
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
    onSetShotReferences: (shotId: string, refs: { imageVariantIds: string[]; videoAssetIds: string[]; audioAssetIds: string[] }) => void;
    orphanNodeCount: number;
    onCleanupOrphans: () => void;
}) {
    const { t } = useTranslation();
    const { modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const siblings = episode?.shots;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
                <Select size="small" className="w-[180px]" value={episode?.id} options={data.episodes.map((item) => ({ value: item.id, label: item.title || t("canvas.production.episodeFallback", { number: item.number }) }))} onChange={onSelectEpisode} />
                <Button size="small" type="primary" icon={<Sparkles className="size-4" />} disabled={!episode || busy} onClick={() => episode && onGenerateEpisode(episode)}>{t("canvas.production.generateEpisodeStoryboard")}</Button>
                <Button size="small" icon={<Sparkles className="size-4" />} disabled={busy || !data.episodes.length} onClick={onGenerateAll}>{t("canvas.production.generateAllStoryboards")}</Button>
                <Button size="small" icon={<Plus className="size-4" />} disabled={!episode} onClick={onAddShot}>{t("canvas.production.addShot")}</Button>
                {orphanNodeCount ? (
                    <Button size="small" danger onClick={() => {
                        modal.confirm({
                            title: t("canvas.production.cleanupOrphans"),
                            content: t("canvas.production.cleanupOrphansDescription", { count: orphanNodeCount }),
                            okText: t("canvas.production.cleanupOrphansConfirm"),
                            cancelText: t("common.cancel"),
                            onOk: onCleanupOrphans,
                        });
                    }}>{t("canvas.production.cleanupOrphans")}（{orphanNodeCount}）</Button>
                ) : null}
            </div>
            {selectedShot ? (
                <div className="space-y-2">
                    <ShotEditor
                        key={selectedShot.key}
                        shot={selectedShot}
                        assets={data.assets}
                        orientation={data.options.orientation}
                        media={data.options}
                        siblings={siblings}
                        node={nodeByKey.get(selectedShot.key)}
                        disabled={busy}
                        isReady={isReady}
                        onSave={onSaveShot}
                        onRegenerate={() => onRegenerate(selectedShot)}
                        onGenerate={() => onGenerateShot(selectedShot)}
                        onLocate={() => onLocate(selectedShot.id)}
                        onReferencesChange={(refs) => onSetShotReferences(selectedShot.id, refs)}
                    />
                    <Button size="small" type="text" danger onClick={() => onRemoveShot(selectedShot.id)}>{t("canvas.production.removeShot")}</Button>
                </div>
            ) : episode ? (
                <div className="space-y-1.5">
                    {episode.shots.map((shot) => {
                        const view = shots.find((item) => item.id === shot.id);
                        const errors = validateShot(shot, data.assets, data.options.orientation, data.options);
                        return (
                            <button key={shot.id} type="button" onClick={() => onSelectShot(shot.id)} className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-surface-hover" style={{ borderColor: theme.node.stroke }}>
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
        <div className="grid gap-2">
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
