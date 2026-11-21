import { CanvasNodeType, type CanvasScriptState, type ScriptAssetKind } from "@/types/canvas";
import { buildScriptProjectView, formatH3Prompt, scriptAssetKey, SCRIPT_ASSET_KIND_LABEL } from "@/lib/canvas/script-model";

export type ScriptNodeSource = CanvasScriptState;

export type ScriptNodePlan = {
    key: string;
    type: CanvasNodeType;
    title: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    content?: string;
    prompt?: string;
    seconds?: string;
    size?: string;
    /** 镜头节点：需要绑定内置 MiniMax H3 全能参考视频工作流。 */
    h3?: boolean;
};
export type ScriptConnectionPlan = { fromKey: string; toKey: string };
export type ScriptNodeLayout = { nodes: ScriptNodePlan[]; connections: ScriptConnectionPlan[] };

/** 五类资产对应的画布节点类型：图片类资产生成图片节点，参考类资产分别生成视频 / 音频节点。 */
const ASSET_NODE_TYPE: Record<ScriptAssetKind, CanvasNodeType> = {
    character: CanvasNodeType.Image,
    scene: CanvasNodeType.Image,
    prop: CanvasNodeType.Image,
    video: CanvasNodeType.Video,
    audio: CanvasNodeType.Audio,
};

const COLUMN = 340;
const ROW = 320;

export function planScriptNodes(
    source: ScriptNodeSource,
    center: { x: number; y: number },
    labels: { source: string; setting: string; outline: string; script: string },
): ScriptNodeLayout {
    const view = buildScriptProjectView(source);
    const baseX = center.x - 2 * COLUMN;
    const baseY = center.y - 300;
    const nodes: ScriptNodePlan[] = [];

    const markdown: { key: string; title: string; content: string }[] = [
        { key: "source", title: labels.source, content: source.source },
        { key: "setting", title: labels.setting, content: source.setting },
        { key: "outline", title: labels.outline, content: source.outline },
        { key: "script", title: labels.script, content: source.script },
    ];
    markdown.forEach((item, index) => {
        if (!item.content.trim()) return;
        nodes.push({ key: item.key, type: CanvasNodeType.Text, title: item.title, content: item.content.trim(), position: { x: baseX, y: baseY + index * ROW }, width: 300, height: 280 });
    });

    const assetX = baseX + COLUMN;
    view.assets.forEach((asset, index) => {
        const type = ASSET_NODE_TYPE[asset.kind];
        nodes.push({
            key: asset.key,
            type,
            title: asset.name || SCRIPT_ASSET_KIND_LABEL[asset.kind],
            prompt: asset.prompt,
            position: { x: assetX + (index % 3) * COLUMN, y: baseY + Math.floor(index / 3) * ROW },
            width: 320,
            height: type === CanvasNodeType.Audio ? 180 : 240,
        });
    });

    const episodeX = assetX + 3 * COLUMN;
    view.episodes.forEach((episode, index) => {
        nodes.push({
            key: episode.key,
            type: CanvasNodeType.Text,
            title: episode.title || `第 ${episode.number} 集`,
            content: `大纲：\n${episode.outline}\n\n正文：\n${episode.script}`.trim(),
            position: { x: episodeX, y: baseY + index * ROW },
            width: 300,
            height: 280,
        });
    });

    const shotX = episodeX + COLUMN;
    view.shots.forEach((shot, index) => {
        nodes.push({
            key: shot.key,
            type: CanvasNodeType.Video,
            title: shot.title,
            prompt: formatH3Prompt(shot.h3),
            seconds: String(shot.duration),
            size: shot.size,
            h3: true,
            position: { x: shotX + (index % 2) * COLUMN, y: baseY + Math.floor(index / 2) * ROW },
            width: 320,
            height: 240,
        });
    });

    const connections: ScriptConnectionPlan[] = [];
    const assetKeys = new Set(view.assets.map((asset) => asset.key));
    view.shots.forEach((shot) => {
        for (const id of [...shot.imageAssetIds, ...shot.videoAssetIds, ...shot.audioAssetIds]) {
            const fromKey = scriptAssetKey(id);
            if (assetKeys.has(fromKey)) connections.push({ fromKey, toKey: shot.key });
        }
    });
    return { nodes, connections };
}
