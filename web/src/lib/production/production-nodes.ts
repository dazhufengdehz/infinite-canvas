import { CanvasNodeType, type ProductionState, type ScriptAssetKind } from "@/types/canvas";
import { t } from "@/i18n";
import { formatH3Prompt, productionAssetKey, productionEpisodeKey, productionShotKey, PRODUCTION_SETTING_KEY, PRODUCTION_OUTLINE_KEY, serializeOutline } from "@/lib/production/production-model";

export type ProductionNodePlan = {
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

export type ProductionConnectionPlan = { fromKey: string; toKey: string };
export type ProductionNodeLayout = { nodes: ProductionNodePlan[]; connections: ProductionConnectionPlan[] };

const ASSET_NODE_TYPE: Record<ScriptAssetKind, CanvasNodeType> = {
    character: CanvasNodeType.Image,
    scene: CanvasNodeType.Image,
    prop: CanvasNodeType.Image,
    video: CanvasNodeType.Video,
    audio: CanvasNodeType.Audio,
};

const COLUMN = 340;
const ROW = 320;

/** 由生产数据派生画布节点计划：设定/大纲/分集正文为只读文本节点，资产与镜头为生成节点。 */
export function planProductionNodes(production: ProductionState, center: { x: number; y: number }): ProductionNodeLayout {
    const baseX = center.x - 2 * COLUMN;
    const baseY = center.y - 300;
    const nodes: ProductionNodePlan[] = [];

    let textRow = 0;
    if (production.setting.trim()) {
        nodes.push({ key: PRODUCTION_SETTING_KEY, type: CanvasNodeType.Text, title: t("canvas.script.settingNode"), content: production.setting.trim(), position: { x: baseX, y: baseY + textRow * ROW }, width: 300, height: 280 });
        textRow += 1;
    }
    if (production.episodes.length) {
        nodes.push({ key: PRODUCTION_OUTLINE_KEY, type: CanvasNodeType.Text, title: t("canvas.script.outlineNode"), content: serializeOutline(production.episodes), position: { x: baseX, y: baseY + textRow * ROW }, width: 300, height: 280 });
        textRow += 1;
    }
    production.episodes.forEach((episode) => {
        if (!episode.script.trim()) return;
        nodes.push({
            key: productionEpisodeKey(episode.id),
            type: CanvasNodeType.Text,
            title: episode.title || t("canvas.production.episodeFallback", { number: episode.number }),
            content: episode.script.trim(),
            position: { x: baseX, y: baseY + textRow * ROW },
            width: 300,
            height: 280,
        });
        textRow += 1;
    });

    const assetX = baseX + COLUMN;
    production.assets.forEach((asset, index) => {
        const type = ASSET_NODE_TYPE[asset.kind];
        nodes.push({
            key: productionAssetKey(asset.id),
            type,
            title: asset.name || t(`canvas.production.kind.${asset.kind}`),
            prompt: asset.prompt,
            position: { x: assetX + (index % 3) * COLUMN, y: baseY + Math.floor(index / 3) * ROW },
            width: 320,
            height: type === CanvasNodeType.Audio ? 180 : 240,
        });
    });

    const shotX = assetX + 3 * COLUMN;
    const shots = production.episodes.flatMap((episode) => episode.shots);
    shots.forEach((shot, index) => {
        nodes.push({
            key: productionShotKey(shot.id),
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

    const connections: ProductionConnectionPlan[] = [];
    const assetKeys = new Set(production.assets.map((asset) => productionAssetKey(asset.id)));
    shots.forEach((shot) => {
        for (const id of [...shot.imageAssetIds, ...shot.videoAssetIds, ...shot.audioAssetIds]) {
            const fromKey = productionAssetKey(id);
            if (assetKeys.has(fromKey)) connections.push({ fromKey, toKey: productionShotKey(shot.id) });
        }
    });
    return { nodes, connections };
}
