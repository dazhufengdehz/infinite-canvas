import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ScriptShot } from "@/types/canvas";

import { productionShotKey } from "@/lib/production/production-model";

/** 镜头的三类有序引用：图片引用是形态 ID，视频与音频是画布节点 ID。 */
export type ShotReferences = { imageVariantIds: string[]; videoAssetIds: string[]; audioAssetIds: string[] };

/** 从节点的 scriptKey 解析出形态 ID；非托管节点返回 null。 */
export function variantIdOfNode(node: CanvasNodeData | undefined): string | null {
    const key = node?.metadata?.scriptKey;
    if (!key?.startsWith("variant:")) return null;
    return key.slice("variant:".length);
}

/** 从节点的 scriptKey 解析出镜头 ID；非托管节点返回 null。 */
export function shotIdOfNode(node: CanvasNodeData | undefined): string | null {
    const key = node?.metadata?.scriptKey;
    if (!key?.startsWith("shot:")) return null;
    return key.slice("shot:".length);
}

/**
 * 从画布连线派生镜头的三类有序引用。
 * 画布连线是唯一权威：连接的先后顺序即 <Picture N> / <Video N> / <Audio N> 的编号顺序。
 * 图片引用来自托管的资产形态节点；视频与音频引用来自用户自己上传并连线的媒体节点。
 */
export function deriveShotReferences(shotId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): ShotReferences {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const shotNodeId = nodes.find((node) => shotIdOfNode(node) === shotId)?.id;
    const result: ShotReferences = { imageVariantIds: [], videoAssetIds: [], audioAssetIds: [] };
    if (!shotNodeId) return result;

    for (const connection of connections) {
        if (connection.kind !== "input" || connection.toNodeId !== shotNodeId) continue;
        const from = nodeById.get(connection.fromNodeId);
        if (!from) continue;
        const variantId = variantIdOfNode(from);
        if (variantId) {
            result.imageVariantIds.push(variantId);
            continue;
        }
        if (from.type === CanvasNodeType.Video) result.videoAssetIds.push(from.id);
        else if (from.type === CanvasNodeType.Audio) result.audioAssetIds.push(from.id);
    }
    return result;
}

/**
 * 按画布连线顺序重算所有镜头的引用数组。
 * 返回需要更新的镜头 ID 与具体改动，供生产态增量落库。
 */
export function syncShotReferencesFromCanvas(production: { episodes: { shots: ScriptShot[] }[] }, nodes: CanvasNodeData[], connections: CanvasConnection[]): Map<string, ShotReferences> {
    const updates = new Map<string, ShotReferences>();
    for (const episode of production.episodes) {
        for (const shot of episode.shots) {
            const derived = deriveShotReferences(shot.id, nodes, connections);
            const changed =
                derived.imageVariantIds.join(",") !== shot.imageVariantIds.join(",") ||
                derived.videoAssetIds.join(",") !== shot.videoAssetIds.join(",") ||
                derived.audioAssetIds.join(",") !== shot.audioAssetIds.join(",");
            if (changed) updates.set(shot.id, derived);
        }
    }
    return updates;
}

/** 生成形态 → 镜头的稳定连线 ID，便于跨次同步识别同一条连线。 */
export function productionConnectionId(variantId: string, shotId: string) {
    return `production-connection:variant:${variantId}:${productionShotKey(shotId)}`;
}

/**
 * 把某个镜头的形态 → 镜头连线调整为给定的引用顺序。
 * 保留已有连线的 id（避免连线闪烁），缺失的按稳定 ID 补建，
 * 不在引用列表中的形态连线会被移除，保证连线与引用严格一致。
 */
export function orderAssetShotConnections(connections: CanvasConnection[], nodes: CanvasNodeData[], shotId: string, refs: ShotReferences): CanvasConnection[] {
    const shotNode = nodes.find((node) => shotIdOfNode(node) === shotId);
    if (!shotNode) return connections;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const variantNodeIdByVariantId = new Map<string, string>();
    for (const node of nodes) {
        const variantId = variantIdOfNode(node);
        if (variantId) variantNodeIdByVariantId.set(variantId, node.id);
    }

    const existing = connections.filter((connection) => connection.kind === "input" && connection.toNodeId === shotNode.id && Boolean(variantIdOfNode(nodeById.get(connection.fromNodeId))));
    const rest = connections.filter((connection) => !existing.includes(connection));
    const used = new Set<string>();
    const ordered: CanvasConnection[] = [];

    for (const variantId of refs.imageVariantIds) {
        const fromNodeId = variantNodeIdByVariantId.get(variantId);
        if (!fromNodeId) continue;
        const found = existing.find((connection) => connection.fromNodeId === fromNodeId && !used.has(connection.id));
        ordered.push(found ?? { id: productionConnectionId(variantId, shotId), fromNodeId, toNodeId: shotNode.id, kind: "input" });
        if (found) used.add(found.id);
    }
    return [...rest, ...ordered];
}
