import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, App, Button, Checkbox, Collapse, Empty, Input, InputNumber, Modal, Segmented, Select, Steps } from "antd";
import { Clapperboard, Sparkles, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { generateScriptStage, type ScriptAdaptOptions, type ScriptAdaptRequest, type ScriptStage } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { readGlobalScriptPreamble, readProjectScriptPreamble, writeGlobalScriptPreamble, writeProjectScriptPreamble } from "@/lib/canvas/script-preamble";
import { generateAssetsContent, generateMarkdownStage, generateStoryboardContent } from "@/lib/canvas/script-generation";
import { assetLabel, buildScriptProjectView, formatAssetList, SCRIPT_ASSET_KINDS, SCRIPT_ASSET_KIND_LABEL, validateH3Shot } from "@/lib/canvas/script-model";
import { useScriptStore } from "@/stores/canvas/use-script-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasScriptOptions, type ScriptAsset, type ScriptStoryboardEpisode } from "@/types/canvas";

type Props = {
    open: boolean;
    projectId: string;
    nodes: CanvasNodeData[];
    onClose: () => void;
    onInsert: () => void;
};

type NovelChapter = { title: string; content: string };
const CONDENSE_TRIGGER = 20000;

export function CanvasScriptAdaptDialog({ open, projectId, nodes, onClose, onInsert }: Props) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [step, setStep] = useState(0);
    const [mode, setMode] = useState<"paste" | "upload" | "canvas">("paste");
    const [source, setSource] = useState("");
    const [chapters, setChapters] = useState<NovelChapter[]>([]);
    const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
    const [canvasNodeId, setCanvasNodeId] = useState<string>();
    const [condensed, setCondensed] = useState("");
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [preambleScope, setPreambleScope] = useState<"global" | "project">("global");
    const [globalPreamble, setGlobalPreamble] = useState("");
    const [projectPreamble, setProjectPreamble] = useState("");

    useEffect(() => {
        if (!open) return;
        setGlobalPreamble(readGlobalScriptPreamble());
        setProjectPreamble(readProjectScriptPreamble(projectId));
    }, [open, projectId]);

    const hydratedRef = useRef(false);
    useEffect(() => {
        if (!open) return;
        hydratedRef.current = false;
        void (async () => {
            await useScriptStore.getState().load(projectId);
            const data = useScriptStore.getState().data;
            if (data) {
                setSource(data.source);
                setCondensed(data.condensed);
                setSetting(data.setting);
                setOutline(data.outline);
                setScript(data.script);
                setAssets(data.assets);
                setStoryboard(data.storyboard);
                setEpisodes(data.options.episodes ?? 12);
                setDuration(data.options.duration ?? 60);
                setGenre(data.options.genre ?? "");
                setAudience(data.options.audience ?? "");
                setOrientation(data.options.orientation ?? "vertical");
                setKeep(data.options.keep ?? "");
                setChange(data.options.change ?? "");
                setStep(data.setting || data.outline || data.script ? 1 : 0);
            }
            hydratedRef.current = true;
        })();
    }, [open, projectId]);

    const effectivePreamble = projectPreamble.trim() || globalPreamble.trim();
    const [episodes, setEpisodes] = useState(12);
    const [duration, setDuration] = useState(60);
    const [genre, setGenre] = useState("");
    const [audience, setAudience] = useState("");
    const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
    const [keep, setKeep] = useState("");
    const [change, setChange] = useState("");
    const [feedback, setFeedback] = useState("");
    const [setting, setSetting] = useState("");
    const [outline, setOutline] = useState("");
    const [script, setScript] = useState("");
    const [assets, setAssets] = useState<ScriptAsset[]>([]);
    const [storyboard, setStoryboard] = useState<ScriptStoryboardEpisode[]>([]);
    const [loading, setLoading] = useState<ScriptStage | null>(null);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState("");

    const options = useMemo<ScriptAdaptOptions>(() => ({ episodes, duration, genre, audience, orientation, keep, change }), [episodes, duration, genre, audience, orientation, keep, change]);

    useEffect(() => {
        if (!open || !hydratedRef.current) return;
        useScriptStore.getState().update({ source, condensed, setting, outline, script, assets, storyboard, options });
    }, [open, source, condensed, setting, outline, script, assets, storyboard, options]);

    useEffect(() => {
        if (!open) return;
        return () => void useScriptStore.getState().flush();
    }, [open]);


    const textNodes = useMemo(() => nodes.filter((node) => node.type === CanvasNodeType.Text && node.metadata?.content?.trim()), [nodes]);
    const effectiveSource = useMemo(() => {
        if (!chapters.length) return source;
        return chapters.filter((_, index) => selectedChapters.has(index)).map((chapter) => `## ${chapter.title}\n${chapter.content}`).join("\n\n");
    }, [chapters, selectedChapters, source]);

    const applyNovelText = (text: string) => {
        const parsed = splitNovelChapters(text);
        setChapters(parsed.length > 1 ? parsed : []);
        setSelectedChapters(new Set(parsed.length > 1 ? parsed.map((_, index) => index) : []));
        setSource(parsed.length > 1 ? text : parsed[0]?.content || text);
        setCondensed("");
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        if (!/\.(txt|md|markdown)$/i.test(file.name)) {
            message.warning(t("canvas.script.uploadHint"));
            return;
        }
        applyNovelText(await file.text());
        setMode("upload");
    };

    const callStage = async (stage: ScriptStage, text: string, extra?: Partial<ScriptAdaptRequest>) => {
        const agent = useAgentStore.getState();
        if (!agent.connected || !agent.url.trim() || !agent.token.trim()) throw new Error(t("canvas.script.needAgent"));
        return generateScriptStage(agent.url.trim(), agent.token.trim(), { stage, source: text, options, setting, outline, script, assets: formatAssetList(assets), preamble: effectivePreamble, feedback, ...extra });
    };

    const generate = async (stage: ScriptStage, text = condensed || effectiveSource) => {
        setLoading(stage);
        setError("");
        setProgress("");
        try {
            if (stage === "assets") {
                if (storyboard.length) throw new Error(t("canvas.script.assetsLocked"));
                setAssets(await generateAssetsContent({ text, call: callStage }));
            } else if (stage === "storyboard") {
                if (!assets.length) throw new Error(t("canvas.script.needAssets"));
                const view = buildScriptProjectView({ outline, script, assets, storyboard: [] });
                const episodes = view.episodes.filter((episode) => episode.outline || episode.script);
                setStoryboard(await generateStoryboardContent({
                    episodes,
                    assets,
                    orientation,
                    text,
                    call: callStage,
                    onProgress: setProgress,
                    progressLabel: (current, total) => t("canvas.script.episodeProgress", { current, total }),
                }));
            } else {
                const content = await generateMarkdownStage({
                    stage,
                    text,
                    outline,
                    call: callStage,
                    onProgress: setProgress,
                    progressLabel: (current, total) => t("canvas.script.episodeProgress", { current, total }),
                    onPart: stage === "script" ? setScript : undefined,
                });
                if (stage === "setting") setSetting(content);
                if (stage === "outline") setOutline(content);
                if (stage === "script") setScript(content);
            }
            setFeedback("");
        } catch (error) {
            const text = error instanceof Error ? error.message : t("canvas.script.failed");
            setError(text);
            message.error(text);
        } finally {
            setLoading(null);
            setProgress("");
        }
    };

    const startFromSource = async () => {
        const text = effectiveSource.trim();
        if (!text) return message.warning(t("canvas.script.emptySource"));
        setError("");
        setStep(1);
        let prepared = text;
        if (text.length > CONDENSE_TRIGGER) {
            setLoading("condense");
            try {
                prepared = await callStage("condense", text);
                setCondensed(prepared);
            } catch (error) {
                const text = error instanceof Error ? error.message : t("canvas.script.failed");
                setStep(0);
                setError(text);
                message.error(text);
                return;
            } finally {
                setLoading(null);
            }
        }
        await generate("setting", prepared);
    };

    const insert = () => {
        if (!setting.trim() || !outline.trim() || !script.trim() || !assets.length || !storyboard.length) {
            message.warning(t("canvas.script.incomplete"));
            return;
        }
        useScriptStore.getState().update({ source: effectiveSource.trim(), condensed, setting, outline, script, assets, storyboard, options });
        void useScriptStore.getState().flush();
        onInsert();
        message.success(t("canvas.script.inserted"));
        onClose();
    };

    const close = () => {
        if (loading) return;
        void useScriptStore.getState().flush();
        onClose();
    };

    const steps = [
        { title: t("canvas.script.stepSource") },
        { title: t("canvas.script.stepSetting") },
        { title: t("canvas.script.stepOutline") },
        { title: t("canvas.script.stepScript") },
        { title: t("canvas.script.stepAssets") },
        { title: t("canvas.script.stepStoryboard") },
    ];
    const stageOfStep: ScriptStage[] = ["setting", "outline", "script", "assets", "storyboard"];

    return (
        <Modal
            open={open}
            onCancel={close}
            footer={null}
            width={960}
            maskClosable={!loading}
            title={<span className="flex items-center gap-2"><Clapperboard className="size-4" />{t("canvas.script.title")}</span>}
        >
            <div className="space-y-4">
                <Steps current={step} items={steps} size="small" />
                <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.script.subtitle")}</p>
                {error ? <Alert type="error" showIcon message={error} /> : null}
                {progress ? <Alert type="info" showIcon message={progress} /> : null}

                {step === 0 ? (
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>{t("canvas.script.sourceLabel")}</span>
                                <Segmented
                                    size="small"
                                    value={mode}
                                    onChange={(value) => setMode(value as "paste" | "upload" | "canvas")}
                                    options={[
                                        { label: t("canvas.script.modePaste"), value: "paste" },
                                        { label: t("canvas.script.modeUpload"), value: "upload" },
                                        { label: t("canvas.script.modeCanvas"), value: "canvas" },
                                    ]}
                                />
                            </div>

                            {mode === "paste" ? (
                                <Input.TextArea
                                    value={source}
                                    onChange={(event) => {
                                        setSource(event.target.value);
                                        setChapters([]);
                                        setCondensed("");
                                    }}
                                    rows={10}
                                    placeholder={t("canvas.script.sourcePlaceholder")}
                                    showCount
                                    maxLength={60000}
                                />
                            ) : null}

                            {mode === "upload" ? (
                                <div className="space-y-2">
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept=".txt,.md,.markdown"
                                        className="hidden"
                                        onChange={(event) => {
                                            void handleFile(event.target.files?.[0]);
                                            event.target.value = "";
                                        }}
                                    />
                                    <div className="flex items-center gap-2">
                                        <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
                                            {t("canvas.script.chooseFile")}
                                        </Button>
                                        <span className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.script.uploadHint")}</span>
                                    </div>
                                </div>
                            ) : null}

                            {mode === "canvas" ? (
                                <Select
                                    className="w-full"
                                    value={canvasNodeId}
                                    placeholder={t("canvas.script.chooseCanvasNode")}
                                    options={textNodes.map((node) => ({ value: node.id, label: node.title || t("canvas.script.scriptNode") }))}
                                    onChange={(value) => {
                                        const node = textNodes.find((item) => item.id === value);
                                        setCanvasNodeId(value);
                                        applyNovelText(node?.metadata?.content || "");
                                    }}
                                />
                            ) : null}

                            {chapters.length > 1 ? (
                                <div className="rounded-md border" style={{ borderColor: theme.node.stroke }}>
                                    <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                                        <span style={{ color: theme.node.muted }}>
                                            {t("canvas.script.chapterSummary", { selected: selectedChapters.size, total: chapters.length, count: effectiveSource.length })}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <Button size="small" type="link" onClick={() => setSelectedChapters(new Set(chapters.map((_, index) => index)))}>{t("canvas.script.selectAll")}</Button>
                                            <Button size="small" type="link" onClick={() => setSelectedChapters(new Set())}>{t("canvas.script.clearAll")}</Button>
                                        </div>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto border-t" style={{ borderColor: theme.node.stroke }}>
                                        {chapters.map((chapter, index) => (
                                            <label key={`${chapter.title}-${index}`} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-surface-hover">
                                                <Checkbox
                                                    checked={selectedChapters.has(index)}
                                                    onChange={(event) => {
                                                        setCondensed("");
                                                        setSelectedChapters((prev) => {
                                                            const next = new Set(prev);
                                                            if (event.target.checked) next.add(index);
                                                            else next.delete(index);
                                                            return next;
                                                        });
                                                    }}
                                                />
                                                <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                                                <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{chapter.content.length} 字</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            {effectiveSource.length > CONDENSE_TRIGGER ? (
                                <p className="text-[11px] text-amber-600">{t("canvas.script.longSourceHint", { count: effectiveSource.length })}</p>
                            ) : null}
                            {effectiveSource.length > 0 ? (
                                <p className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.script.sourceLength", { count: effectiveSource.length })}</p>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label={t("canvas.script.episodes")}>
                                <InputNumber min={1} max={100} value={episodes} onChange={(value) => setEpisodes(Number(value) || 1)} className="w-full" />
                            </Field>
                            <Field label={t("canvas.script.duration")}>
                                <InputNumber min={15} max={600} step={15} value={duration} onChange={(value) => setDuration(Number(value) || 60)} className="w-full" />
                            </Field>
                            <Field label={t("canvas.script.genre")}>
                                <Input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder={t("canvas.script.genrePlaceholder")} />
                            </Field>
                            <Field label={t("canvas.script.audience")}>
                                <Input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder={t("canvas.script.audiencePlaceholder")} />
                            </Field>
                            <Field label={t("canvas.script.orientation")}>
                                <Segmented
                                    block
                                    value={orientation}
                                    onChange={(value) => setOrientation(value as "vertical" | "horizontal")}
                                    options={[
                                        { label: t("canvas.script.vertical"), value: "vertical" },
                                        { label: t("canvas.script.horizontal"), value: "horizontal" },
                                    ]}
                                />
                            </Field>
                            <Field label={t("canvas.script.keep")}>
                                <Input value={keep} onChange={(event) => setKeep(event.target.value)} placeholder={t("canvas.script.keepPlaceholder")} />
                            </Field>
                            <Field label={t("canvas.script.change")}>
                                <Input value={change} onChange={(event) => setChange(event.target.value)} placeholder={t("canvas.script.changePlaceholder")} />
                            </Field>
                        </div>
                        <Collapse
                            size="small"
                            items={[{
                                key: "preamble",
                                label: <span className="text-xs">{t("canvas.script.preambleTitle")}{effectivePreamble ? ` · ${t("canvas.script.preambleActive")}` : ""}</span>,
                                children: (
                                    <div className="space-y-2">
                                        <Segmented
                                            size="small"
                                            value={preambleScope}
                                            onChange={(value) => setPreambleScope(value as "global" | "project")}
                                            options={[
                                                { label: t("canvas.script.preambleGlobal"), value: "global" },
                                                { label: t("canvas.script.preambleProject"), value: "project" },
                                            ]}
                                        />
                                        <Input.TextArea
                                            rows={4}
                                            value={preambleScope === "global" ? globalPreamble : projectPreamble}
                                            onChange={(event) => {
                                                if (preambleScope === "global") setGlobalPreamble(event.target.value);
                                                else setProjectPreamble(event.target.value);
                                            }}
                                            placeholder={preambleScope === "project" ? globalPreamble || t("canvas.script.preamblePlaceholder") : t("canvas.script.preamblePlaceholder")}
                                        />
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px]" style={{ color: theme.node.muted }}>
                                                {projectPreamble.trim() ? t("canvas.script.preambleUsingProject") : globalPreamble.trim() ? t("canvas.script.preambleUsingGlobal") : t("canvas.script.preambleEmpty")}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                {preambleScope === "project" && projectPreamble.trim() ? (
                                                    <Button size="small" onClick={() => {
                                                        setProjectPreamble("");
                                                        writeProjectScriptPreamble(projectId, "");
                                                    }}>{t("canvas.script.preambleClear")}</Button>
                                                ) : null}
                                                <Button size="small" type="primary" onClick={() => {
                                                    if (preambleScope === "global") writeGlobalScriptPreamble(globalPreamble);
                                                    else writeProjectScriptPreamble(projectId, projectPreamble);
                                                    message.success(t("canvas.script.preambleSaved"));
                                                }}>{t("canvas.script.preambleSave")}</Button>
                                            </div>
                                        </div>
                                    </div>
                                ),
                            }]}
                        />
                    </div>
                ) : null}

                {step === 1 ? (
                    <StageEditor value={setting} onChange={setSetting} muted={theme.node.muted} hint={t("canvas.script.editableHint")} />
                ) : null}
                {step === 2 ? (
                    <StageEditor value={outline} onChange={setOutline} muted={theme.node.muted} hint={t("canvas.script.editableHint")} />
                ) : null}
                {step === 3 ? (
                    <StageEditor value={script} onChange={setScript} muted={theme.node.muted} hint={t("canvas.script.editableHint")} />
                ) : null}
                {step === 4 ? (
                    <div className="grid gap-1.5">
                        <AssetsSummary assets={assets} />
                        <span className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.script.assetsHint")}</span>
                    </div>
                ) : null}
                {step === 5 ? (
                    <div className="grid gap-1.5">
                        <StoryboardSummary storyboard={storyboard} assets={assets} orientation={orientation} />
                        <span className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.script.storyboardHint")}</span>
                    </div>
                ) : null}

                {step > 0 ? (
                    <Input
                        value={feedback}
                        onChange={(event) => setFeedback(event.target.value)}
                        placeholder={t("canvas.script.feedbackPlaceholder")}
                    />
                ) : null}

                <div className="flex items-center justify-between gap-2">
                    <Button onClick={step === 0 ? close : () => setStep(step - 1)} disabled={Boolean(loading)}>
                        {step === 0 ? t("common.cancel") : t("canvas.script.prev")}
                    </Button>
                    <div className="flex items-center gap-2">
                        {step > 0 ? (
                            <Button icon={<Sparkles className="size-4" />} loading={Boolean(loading)} onClick={() => void generate(stageOfStep[step - 1])}>
                                {t("canvas.script.regenerate")}
                            </Button>
                        ) : null}
                        {step < 5 ? (
                            <Button
                                type="primary"
                                loading={Boolean(loading)}
                                disabled={step === 0 && !effectiveSource.trim()}
                                onClick={() => {
                                    if (step === 0) {
                                        void startFromSource();
                                        return;
                                    }
                                    if (step === 1 && !setting.trim()) return message.warning(t("canvas.script.emptyStage"));
                                    if (step === 2 && !outline.trim()) return message.warning(t("canvas.script.emptyStage"));
                                    if (step === 3 && !script.trim()) return message.warning(t("canvas.script.emptyStage"));
                                    if (step === 4 && !assets.length) return message.warning(t("canvas.script.emptyStage"));
                                    setStep(step + 1);
                                    void generate(stageOfStep[step]);
                                }}
                            >
                                {t("canvas.script.next")}
                            </Button>
                        ) : (
                            <Button type="primary" onClick={insert} disabled={Boolean(loading)}>
                                {t("canvas.script.insert")}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function AssetsSummary({ assets }: { assets: ScriptAsset[] }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!assets.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.script.noAssets")} />;
    return (
        <div className="max-h-[420px] space-y-3 overflow-y-auto">
            {SCRIPT_ASSET_KINDS.map((kind) => {
                const list = assets.filter((asset) => asset.kind === kind);
                if (!list.length) return null;
                return (
                    <div key={kind} className="space-y-1">
                        <div className="text-xs font-medium">{SCRIPT_ASSET_KIND_LABEL[kind]} · {list.length}</div>
                        <ul className="space-y-1">
                            {list.map((asset) => (
                                <li key={asset.id} className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: theme.node.stroke }}>
                                    <div style={{ color: theme.node.text }}>{assetLabel(asset)}</div>
                                    {asset.description ? <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>{asset.description}</div> : null}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}

function StoryboardSummary({ storyboard, assets, orientation }: { storyboard: ScriptStoryboardEpisode[]; assets: ScriptAsset[]; orientation?: CanvasScriptOptions["orientation"] }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!storyboard.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.script.noStoryboard")} />;
    const errors = storyboard.flatMap((episode) => episode.shots.flatMap((shot) => validateH3Shot(shot, assets, orientation).map((error) => `第 ${episode.number} 集 · ${shot.title || "未命名镜头"}：${error}`)));
    const shots = storyboard.reduce((total, episode) => total + episode.shots.length, 0);
    return (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
            <div className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.script.storyboardSummary", { episodes: storyboard.length, shots })}</div>
            {storyboard.map((episode) => (
                <div key={episode.id} className="flex items-center justify-between rounded-md border px-2 py-1 text-xs" style={{ borderColor: theme.node.stroke }}>
                    <span className="min-w-0 flex-1 truncate">{episode.title || `第 ${episode.number} 集`}</span>
                    <span className="shrink-0" style={{ color: theme.node.muted }}>{t("canvas.script.shotCount", { count: episode.shots.length })}</span>
                </div>
            ))}
            {errors.length ? (
                <Alert
                    type="warning"
                    showIcon
                    message={t("canvas.script.storyboardErrors", { count: errors.length })}
                    description={<ul className="space-y-0.5 text-[11px]">{errors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}</ul>}
                />
            ) : null}
        </div>
    );
}

function StageEditor({ value, onChange, muted, hint }: { value: string; onChange: (value: string) => void; muted: string; hint: string }) {
    return (
        <div className="grid gap-1.5">
            <Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} rows={18} placeholder="…" />
            <span className="text-[11px]" style={{ color: muted }}>{hint}</span>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-1.5">
            <span className="text-xs font-medium">{label}</span>
            {children}
        </label>
    );
}

function splitNovelChapters(text: string): NovelChapter[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const matches = [...trimmed.matchAll(/^\s*(第[0-9一二三四五六七八九十百千零两]+[章节回卷][^\n]*)$/gm)];
    if (!matches.length) return [{ title: "全文", content: trimmed }];
    const chapters: NovelChapter[] = [];
    const intro = trimmed.slice(0, matches[0].index ?? 0).trim();
    if (intro) chapters.push({ title: "序章", content: intro });
    matches.forEach((match, index) => {
        chapters.push({
            title: match[1].trim(),
            content: trimmed.slice(match.index ?? 0, matches[index + 1]?.index ?? trimmed.length).trim(),
        });
    });
    return chapters;
}
