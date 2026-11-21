import { useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Tooltip } from "antd";
import { Boxes, Copy, Image as ImageIcon, MapPin, Music, Plus, Sparkles, Square, Trash2, Upload, Users, Video } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { assetLabel, buildScriptProjectView, createScriptAsset, scriptAssetKey } from "@/lib/canvas/script-model";
import { useScriptStore } from "@/stores/canvas/use-script-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ScriptAsset, ScriptAssetKind, ScriptShot } from "@/types/canvas";

type Props = {
    nodes: CanvasNodeData[];
    batch: { total: number; done: number; failed: number; running: boolean };
    onSync: () => void;
    onGenerate: (keys: string[]) => void;
    onStop: () => void;
    onUploadAsset: (key: string, file: File) => Promise<void>;
    onLocate: (key: string) => void;
};

/** 独立管理的资产类型：图片类三类 + 参考音频，参考视频仍在镜头里引用。 */
const MANAGED_KINDS: ScriptAssetKind[] = ["character", "scene", "prop", "audio"];
const KIND_ICON: Record<ScriptAssetKind, typeof ImageIcon> = { character: Users, scene: MapPin, prop: ImageIcon, video: Video, audio: Music };
const ACCEPT: Record<ScriptAssetKind, string> = { character: "image/*", scene: "image/*", prop: "image/*", video: "video/*", audio: "audio/*" };
const DEFAULT_NAME: Record<ScriptAssetKind, string> = {
    character: "canvas.assets.newCharacter",
    scene: "canvas.assets.newScene",
    prop: "canvas.assets.newProp",
    video: "canvas.assets.newVideo",
    audio: "canvas.assets.newAudio",
};

/** 资产管理视图：人物 / 场景 / 道具 / 参考音频各自独立分区，可新增、复制、删除、上传与按分类批量生成。 */
export function CanvasScriptAssetsView({ nodes, batch, onSync, onGenerate, onStop, onUploadAsset, onLocate }: Props) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const data = useScriptStore((state) => state.data);
    const [selectedId, setSelectedId] = useState<string>();
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

    const selected = view.assets.find((asset) => asset.id === selectedId) || null;
    const usagesOf = (id: string) => view.shots.filter((shot: ScriptShot) => [...shot.imageAssetIds, ...shot.videoAssetIds, ...shot.audioAssetIds].includes(id));

    const commit = (assets: ScriptAsset[]) => {
        useScriptStore.getState().update({ assets });
        onSync();
    };

    const add = (kind: ScriptAssetKind) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        const asset: ScriptAsset = { ...createScriptAsset(kind), name: t(DEFAULT_NAME[kind]) };
        commit([...current.assets, asset]);
        setSelectedId(asset.id);
    };

    const duplicate = (asset: ScriptAsset) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        const copy: ScriptAsset = { ...asset, id: nanoid(), name: `${asset.name || t("canvas.storyboard.untitled")} ${t("canvas.assets.copySuffix")}` };
        const index = current.assets.findIndex((item) => item.id === asset.id);
        const next = current.assets.slice();
        next.splice(index < 0 ? next.length : index + 1, 0, copy);
        commit(next);
        setSelectedId(copy.id);
    };

    const remove = (asset: ScriptAsset) => {
        const name = asset.name || t("canvas.storyboard.untitled");
        const count = usagesOf(asset.id).length;
        modal.confirm({
            title: t("canvas.assets.removeTitle"),
            content: count ? t("canvas.assets.removeUsed", { name, count }) : t("canvas.assets.removeUnused", { name }),
            okButtonProps: { danger: true },
            onOk: () => {
                const current = useScriptStore.getState().data;
                if (!current) return;
                commit(current.assets.filter((item) => item.id !== asset.id));
                setSelectedId((value) => (value === asset.id ? undefined : value));
                message.success(t("canvas.assets.removed"));
            },
        });
    };

    const save = (next: ScriptAsset) => {
        const current = useScriptStore.getState().data;
        if (!current) return;
        commit(current.assets.map((asset) => (asset.id === next.id ? next : asset)));
        message.success(t("canvas.storyboard.saved"));
    };

    const keysOf = (kind?: ScriptAssetKind) =>
        view.assets
            .filter((asset) => MANAGED_KINDS.includes(asset.kind) && (!kind || asset.kind === kind))
            .map((asset) => asset.key)
            .filter((key) => nodeByKey.get(key)?.metadata?.status !== "success");

    return (
        <section className="absolute inset-0 z-40 flex flex-col" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <div className="flex min-h-0 flex-1">
                <aside className="flex w-[240px] shrink-0 flex-col gap-3.5 overflow-y-auto border-r p-3" style={{ borderColor: theme.toolbar.border }}>
                    {!data ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.storyboard.loading")} /> : null}
                    {data
                        ? MANAGED_KINDS.map((kind) => {
                              const Icon = KIND_ICON[kind];
                              const list = view.assets.filter((asset) => asset.kind === kind);
                              return (
                                  <div key={kind} className="space-y-1">
                                      <div className="flex items-center gap-1 px-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                          <Icon className="size-3" />
                                          <span className="min-w-0 flex-1 truncate">{t(`canvas.storyboard.kind.${kind}`)}</span>
                                          <span>{list.length}</span>
                                          <Tooltip title={t("canvas.assets.generateKind")}>
                                              <button
                                                  type="button"
                                                  onClick={() => onGenerate(keysOf(kind))}
                                                  className="grid size-5 place-items-center rounded transition hover:bg-surface-hover"
                                                  aria-label={t("canvas.assets.generateKind")}
                                              >
                                                  <Sparkles className="size-3" />
                                              </button>
                                          </Tooltip>
                                          <Tooltip title={t("canvas.assets.add")}>
                                              <button type="button" onClick={() => add(kind)} className="grid size-5 place-items-center rounded transition hover:bg-surface-hover" aria-label={t("canvas.assets.add")}>
                                                  <Plus className="size-3" />
                                              </button>
                                          </Tooltip>
                                      </div>
                                      {list.length ? (
                                          list.map((asset) => {
                                              const status = nodeByKey.get(asset.key)?.metadata?.status;
                                              const dot = status === "success" ? theme.state.success : status === "error" ? theme.state.danger : status === "loading" ? theme.state.warning : theme.node.muted;
                                              const count = usagesOf(asset.id).length;
                                              return (
                                                  <button
                                                      key={asset.id}
                                                      type="button"
                                                      onClick={() => setSelectedId(asset.id)}
                                                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-surface-hover"
                                                      style={{ background: selectedId === asset.id ? theme.toolbar.activeBg : undefined, color: theme.node.text }}
                                                  >
                                                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
                                                      <span className="min-w-0 flex-1 truncate">{asset.name || t("canvas.storyboard.untitled")}</span>
                                                      {count ? <span className="shrink-0 text-[10px]" style={{ color: theme.node.muted }}>{count}</span> : null}
                                                  </button>
                                              );
                                          })
                                      ) : (
                                          <p className="px-2 text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.assets.emptyKind")}</p>
                                      )}
                                  </div>
                              );
                          })
                        : null}
                    {data ? <p className="px-2 text-[11px] leading-relaxed" style={{ color: theme.node.muted }}>{t("canvas.assets.videoHint")}</p> : null}
                </aside>

                <main className="min-w-0 flex-1 overflow-y-auto p-5">
                    {!data ? null : !selected ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assets.selectHint")} />
                    ) : (
                        <AssetPanel
                            key={selected.id}
                            asset={selected}
                            node={nodeByKey.get(selected.key)}
                            usages={usagesOf(selected.id)}
                            onSave={save}
                            onGenerate={() => onGenerate([selected.key])}
                            onUpload={() => fileRef.current?.click()}
                            onDuplicate={() => duplicate(selected)}
                            onRemove={() => remove(selected)}
                            onLocate={onLocate}
                        />
                    )}
                </main>
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-2" style={{ borderColor: theme.toolbar.border }}>
                <Button size="small" type="text" icon={<Sparkles className="size-4" />} onClick={() => onGenerate(keysOf())}>{t("canvas.assets.generateAll")}</Button>
                {batch.running ? <Button size="small" type="text" icon={<Square className="size-4" />} onClick={onStop}>{t("canvas.storyboard.stop")}</Button> : null}
                <span className="ml-auto text-xs" style={{ color: theme.node.muted }}>
                    {batch.total ? t("canvas.storyboard.progress", { done: batch.done, total: batch.total, failed: batch.failed }) : t("canvas.assets.total", { count: view.assets.filter((asset) => MANAGED_KINDS.includes(asset.kind)).length })}
                </span>
            </footer>

            <input
                ref={fileRef}
                type="file"
                accept={selected ? ACCEPT[selected.kind] : "image/*"}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (!file || !selected) return;
                    void onUploadAsset(selected.key, file);
                }}
            />
        </section>
    );
}

function AssetPanel({
    asset,
    node,
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
    usages: { key: string; number: number; title: string; episodeTitle: string }[];
    onSave: (asset: ScriptAsset) => void;
    onGenerate: () => void;
    onUpload: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
    onLocate: (key: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<ScriptAsset>(asset);
    const dirty = draft.name !== asset.name || draft.description !== asset.description || draft.prompt !== asset.prompt;
    const content = node?.metadata?.content;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Boxes className="size-4" />
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{assetLabel(asset)}</h3>
                <span className="text-xs" style={{ color: theme.node.muted }}>{node ? t("canvas.assets.nodeLinked") : t("canvas.assets.nodeMissing")}</span>
                <Tooltip title={t("canvas.storyboard.locate")}>
                    <Button size="small" type="text" disabled={!node} icon={<MapPin className="size-4" />} onClick={() => onLocate(asset.key)} />
                </Tooltip>
            </div>

            <div className="flex items-start gap-4">
                <div className="flex h-[140px] w-[220px] shrink-0 items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                    {content && asset.kind === "audio" ? <audio className="w-full" controls src={content} /> : null}
                    {content && asset.kind !== "audio" ? <img src={content} alt={asset.name} className="size-full object-cover" /> : null}
                    {!content ? <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.assets.mediaEmpty")}</span> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<Upload className="size-4" />} onClick={onUpload}>{t("canvas.storyboard.upload")}</Button>
                    <Button size="small" icon={<Sparkles className="size-4" />} onClick={onGenerate}>{t("canvas.storyboard.generate")}</Button>
                    <Button size="small" icon={<Copy className="size-4" />} onClick={onDuplicate}>{t("canvas.assets.duplicate")}</Button>
                    <Button size="small" danger icon={<Trash2 className="size-4" />} onClick={onRemove}>{t("canvas.assets.remove")}</Button>
                </div>
            </div>

            <label className="grid gap-1">
                <span className="text-xs font-medium">{t("canvas.storyboard.assetName")}</span>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="grid gap-1">
                <span className="text-xs font-medium">{t("canvas.storyboard.assetDescription")}</span>
                <Input.TextArea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} autoSize={{ minRows: 3, maxRows: 8 }} />
            </label>
            <label className="grid gap-1">
                <span className="text-xs font-medium">{t("canvas.storyboard.assetPrompt")}</span>
                <Input.TextArea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} autoSize={{ minRows: 5, maxRows: 14 }} />
            </label>
            <Button size="small" disabled={!dirty || !draft.name.trim()} onClick={() => onSave(draft)}>{t("canvas.storyboard.save")}</Button>

            <div className="space-y-1">
                <div className="text-xs font-medium">{t("canvas.assets.usages", { count: usages.length })}</div>
                {usages.length ? (
                    usages.map((shot) => (
                        <button
                            key={shot.key}
                            type="button"
                            onClick={() => onLocate(shot.key)}
                            className="flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition hover:bg-surface-hover"
                            style={{ borderColor: theme.node.stroke }}
                        >
                            <span className="min-w-0 flex-1 truncate">{shot.title || t("canvas.storyboard.untitled")}</span>
                            <span className="shrink-0 text-[10px]" style={{ color: theme.node.muted }}>{`${shot.episodeTitle || ""} #${shot.number}`.trim()}</span>
                        </button>
                    ))
                ) : (
                    <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.assets.usageEmpty")}</p>
                )}
            </div>

            <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.assets.hint")}</p>
        </div>
    );
}
