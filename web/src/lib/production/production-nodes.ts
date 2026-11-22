import { CanvasNodeType, type ProductionState, type ScriptAssetKind, type ScriptShot } from "@/types/canvas";
import { t } from "@/i18n";
import {
    assetVariants,
    formatH3Prompt,
    mergeAssetH3,
    productionEpisodeKey,
    productionShotKey,
    PRODUCTION_SETTING_KEY,
    PRODUCTION_OUTLINE_KEY,
    serializeOutline,
    variantH3,
    variantPrompt,
} from "@/lib/production/production-model";

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
    /** 显式指定的工作流 ID：来自批量生成设置，优先于渠道默认。 */
    workflowId?: string;
    /** 固定种子；-1 或缺省表示随机。 */
    seed?: number;
};

export type ProductionConnectionPlan = { fromKey: string; toKey: string };
export type ProductionNodeLayout = { nodes: ProductionNodePlan[]; connections: ProductionConnectionPlan[] };

const ASSET_NODE_TYPE: Record<ScriptAssetKind, CanvasNodeType> = {
    character: CanvasNodeType.Image,
    scene: CanvasNodeType.Image,
    prop: CanvasNodeType.Image,
};

const COLUMN = 340;
const ROW = 320;

/** 形态节点键：每个形态独立成节点。 */
export const productionVariantKey = (variantId: string) => `variant:${variantId}`;

/** 由生产数据派生画布节点计划：设定/大纲/分集正文为只读文本节点，资产形态与镜头为生成节点。 */
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

    // 每个资产形态一个图片节点；无形态时用资产自身作为默认形态节点。
    const assetX = baseX + COLUMN;
    const batch = production.batch;
    const variants = production.assets.flatMap((asset) => assetVariants(asset).map((variant) => ({ asset, variant })));
    variants.forEach(({ asset, variant }, index) => {
        nodes.push({
            key: productionVariantKey(variant.id),
            type: CanvasNodeType.Image,
            title: variant.name ? `${asset.name} · ${variant.name}` : asset.name || t(`canvas.production.kind.${asset.kind}`),
            prompt: variantPrompt(asset, variant),
            position: { x: assetX + (index % 3) * COLUMN, y: baseY + Math.floor(index / 3) * ROW },
            width: 320,
            height: 240,
            ...(batch.assetWorkflowId ? { workflowId: batch.assetWorkflowId } : {}),
            ...(batch.assetSize ? { size: batch.assetSize } : {}),
            ...(batch.seed >= 0 ? { seed: batch.seed } : {}),
        });
    });

    const shotX = assetX + 3 * COLUMN;
    const shots = production.episodes.flatMap((episode) => episode.shots);
    // 上一镜头按集内顺序取，跨集不继承站位。
    const previousByShot = new Map<string, ScriptShot>();
    production.episodes.forEach((episode) => {
        episode.shots.forEach((shot, index) => {
            if (index > 0) previousByShot.set(shot.id, episode.shots[index - 1]);
        });
    });
    shots.forEach((shot, index) => {
        const previous = previousByShot.get(shot.id);
        nodes.push({
            key: productionShotKey(shot.id),
            type: CanvasNodeType.Video,
            title: shot.title,
            prompt: formatH3Prompt(mergeAssetH3(shot, production.assets, { previous, options: production.options })),
            seconds: batch.shotSeconds > 0 ? String(batch.shotSeconds) : String(shot.duration),
            size: shot.size,
            h3: true,
            ...(batch.shotWorkflowId ? { workflowId: batch.shotWorkflowId } : {}),
            ...(batch.seed >= 0 ? { seed: batch.seed } : {}),
            position: { x: shotX + (index % 2) * COLUMN, y: baseY + Math.floor(index / 2) * ROW },
            width: 320,
            height: 240,
        });
    });

    const connections: ProductionConnectionPlan[] = [];
    const variantKeys = new Set(variants.map(({ variant }) => productionVariantKey(variant.id)));
    shots.forEach((shot) => {
        for (const id of shot.imageVariantIds) {
            const fromKey = productionVariantKey(id);
            if (variantKeys.has(fromKey)) connections.push({ fromKey, toKey: productionShotKey(shot.id) });
        }
    });
    return { nodes, connections };
}

/**
 * 角色音色参考的连线计划：镜头引用了该角色的任一形态时，
 * 把该角色的音色音频节点也连到镜头，作为音频参考。
 */
export function planVoiceConnections(production: ProductionState, nodes: { id: string; metadata?: { scriptKey?: string } }[]): ProductionConnectionPlan[] {
    const nodeIdByKey = new Map<string, string>();
    for (const node of nodes) {
        const key = node.metadata?.scriptKey;
        if (key) nodeIdByKey.set(key, node.id);
    }
    const connections: ProductionConnectionPlan[] = [];
    for (const shot of production.episodes.flatMap((episode) => episode.shots)) {
        const shotKey = productionShotKey(shot.id);
        const shotNodeId = nodeIdByKey.get(shotKey);
        if (!shotNodeId) continue;
        const referencedAssets = new Set(
            shot.imageVariantIds
                .map((variantId) => production.assets.find((asset) => assetVariants(asset).some((variant) => variant.id === variantId)))
                .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)),
        );
        for (const asset of referencedAssets) {
            const voiceNodeId = asset.voiceNodeId;
            if (!voiceNodeId || voiceNodeId === shotNodeId) continue;
            connections.push({ fromKey: voiceNodeId, toKey: shotKey });
        }
    }
    return connections;
}
