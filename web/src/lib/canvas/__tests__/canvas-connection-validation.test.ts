import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import {
    findInvalidNodeConnections,
    getAllInvalidConnectionIds,
    getConnectionRejectionDetail,
    validateInputConnection,
} from "@/lib/canvas/canvas-node-geometry";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeTypeId,
} from "@/types/canvas";

/** 最小节点工厂：只填校验用到的字段，其余给合理默认值。 */
function makeNode(id: string, type: CanvasNodeTypeId): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
    };
}

/** 构造 applyCanvasAgentOps 所需的最小快照。 */
function makeSnapshot(nodes: CanvasNodeData[], connections: CanvasConnection[] = []): CanvasAgentSnapshot {
    return {
        projectId: "p1",
        canvasId: "c1",
        title: "t",
        nodes,
        connections,
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

/** 一条已存在的 input 连线。 */
function makeConnection(id: string, fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id, fromNodeId, toNodeId, kind: "input" };
}

describe("validateInputConnection", () => {
    it("合法：资源节点 -> Config", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const target = makeNode("cfg-1", CanvasNodeType.Config);
        const nodes = [source, target];

        const result = validateInputConnection(source.id, target.id, nodes);

        expect(result).toEqual({ fromNodeId: source.id, toNodeId: target.id });
    });

    it("拒绝：来源节点不存在", () => {
        const target = makeNode("cfg-1", CanvasNodeType.Config);
        const nodes = [target];

        expect(validateInputConnection("ghost", target.id, nodes)).toBeNull();
    });

    it("拒绝：目标节点不存在", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const nodes = [source];

        expect(validateInputConnection(source.id, "ghost", nodes)).toBeNull();
    });

    it("拒绝：自连接（from === to）", () => {
        const node = makeNode("img-1", CanvasNodeType.Image);
        const nodes = [node];

        expect(validateInputConnection(node.id, node.id, nodes)).toBeNull();
    });

    it("拒绝：Config 作为来源", () => {
        const config = makeNode("cfg-1", CanvasNodeType.Config);
        const target = makeNode("img-2", CanvasNodeType.Image);
        const nodes = [config, target];

        expect(validateInputConnection(config.id, target.id, nodes)).toBeNull();
    });

    it("拒绝：Group 作为目标", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const group = makeNode("grp-1", CanvasNodeType.Group);
        const nodes = [source, group];

        expect(validateInputConnection(source.id, group.id, nodes)).toBeNull();
    });

    it("拒绝：from/to 重复的既有连线", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const target = makeNode("cfg-1", CanvasNodeType.Config);
        const nodes = [source, target];
        const existing = [makeConnection("c-1", source.id, target.id)];

        expect(validateInputConnection(source.id, target.id, nodes, existing)).toBeNull();
    });
});

describe("applyCanvasAgentOps - connect_nodes", () => {
    it("合法边：新增一条 kind 为 input 的连线", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const target = makeNode("cfg-1", CanvasNodeType.Config);
        const snapshot = makeSnapshot([source, target]);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: source.id, toNodeId: target.id },
        ]);

        expect(result.connections).toHaveLength(1);
        const created = result.connections[0];
        expect(created.fromNodeId).toBe(source.id);
        expect(created.toNodeId).toBe(target.id);
        expect(created.kind).toBe("input");
        expect(created.id).toBeTruthy();
    });

    it("拒绝：来源节点不存在，连线数不变", () => {
        const target = makeNode("cfg-1", CanvasNodeType.Config);
        const snapshot = makeSnapshot([target]);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: "ghost", toNodeId: target.id },
        ]);

        expect(result.connections).toHaveLength(0);
    });

    it("拒绝：目标节点不存在，连线数不变", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const snapshot = makeSnapshot([source]);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: source.id, toNodeId: "ghost" },
        ]);

        expect(result.connections).toHaveLength(0);
    });

    it("拒绝：自连接，连线数不变", () => {
        const node = makeNode("img-1", CanvasNodeType.Image);
        const snapshot = makeSnapshot([node]);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: node.id, toNodeId: node.id },
        ]);

        expect(result.connections).toHaveLength(0);
    });

    it("拒绝：Config 作为来源，连线数不变", () => {
        const config = makeNode("cfg-1", CanvasNodeType.Config);
        const target = makeNode("img-2", CanvasNodeType.Image);
        const snapshot = makeSnapshot([config, target]);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: config.id, toNodeId: target.id },
        ]);

        expect(result.connections).toHaveLength(0);
    });

    it("拒绝：Group 作为目标，连线数不变", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const group = makeNode("grp-1", CanvasNodeType.Group);
        const snapshot = makeSnapshot([source, group]);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: source.id, toNodeId: group.id },
        ]);

        expect(result.connections).toHaveLength(0);
    });

    it("拒绝：from/to 重复的既有连线，连线数不变", () => {
        const source = makeNode("img-1", CanvasNodeType.Image);
        const target = makeNode("cfg-1", CanvasNodeType.Config);
        const existing = [makeConnection("c-1", source.id, target.id)];
        const snapshot = makeSnapshot([source, target], existing);

        const result = applyCanvasAgentOps(snapshot, [
            { type: "connect_nodes", fromNodeId: source.id, toNodeId: target.id },
        ]);

        expect(result.connections).toHaveLength(1);
        expect(result.connections[0].id).toBe("c-1");
    });
});

describe("Model-Driven Multimodal Connection Guards (Issue #8)", () => {
    it("Omni Video: 允许最多 9 张图片、3 个视频、3 个音频，超出立即拒绝", () => {
        const omniNode: CanvasNodeData = {
            ...makeNode("omni-node", CanvasNodeType.Video),
            metadata: { modelId: "omni-video-minimax-h3-ms-v10", videoMode: "omni" },
        };

        // 构造 9 张已连图片
        const imgNodes = Array.from({ length: 10 }, (_, i) => makeNode(`img-${i + 1}`, CanvasNodeType.Image));
        const imgConns = imgNodes.slice(0, 9).map((n, i) => makeConnection(`c-img-${i + 1}`, n.id, omniNode.id));
        const allNodes = [omniNode, ...imgNodes];

        // 已经有 9 张图时，第 10 张图被拒绝
        expect(validateInputConnection(imgNodes[9].id, omniNode.id, allNodes, imgConns)).toBeNull();

        // 构造 3 个已连视频
        const vidNodes = Array.from({ length: 4 }, (_, i) => makeNode(`vid-${i + 1}`, CanvasNodeType.Video));
        const vidConns = vidNodes.slice(0, 3).map((n, i) => makeConnection(`c-vid-${i + 1}`, n.id, omniNode.id));
        const allNodesWithVids = [omniNode, ...vidNodes];

        // 已经有 3 个视频时，第 4 个视频被拒绝
        expect(validateInputConnection(vidNodes[3].id, omniNode.id, allNodesWithVids, vidConns)).toBeNull();
    });

    it("模型切换降低配额时，实时标识超额的既有连线 (findInvalidNodeConnections)", () => {
        const node: CanvasNodeData = {
            ...makeNode("target-node", CanvasNodeType.Image),
            metadata: { modelId: "image-qwen-4x4" },
        };
        const img1 = makeNode("img-1", CanvasNodeType.Image);
        const img2 = makeNode("img-2", CanvasNodeType.Image);
        const img3 = makeNode("img-3", CanvasNodeType.Image);

        const nodes = [node, img1, img2, img3];
        const connections = [
            makeConnection("c-1", img1.id, node.id),
            makeConnection("c-2", img2.id, node.id),
            makeConnection("c-3", img3.id, node.id),
        ];

        const invalid = findInvalidNodeConnections(node.id, nodes, connections);
        expect(invalid.has("c-1")).toBe(false);
        expect(invalid.has("c-2")).toBe(true);
        expect(invalid.has("c-3")).toBe(true);

        node.metadata = { modelId: "image-qwen" };
        const invalidAfterOmni = findInvalidNodeConnections(node.id, nodes, connections);
        expect(invalidAfterOmni.size).toBe(0);

        const allInvalid = getAllInvalidConnectionIds(nodes, connections);
        expect(allInvalid.size).toBe(0);
    });

    describe("getConnectionRejectionDetail", () => {
        it("Omni Video 连第 10 张图时返回具体的配额超限诊断", () => {
            const omniNode: CanvasNodeData = {
                ...makeNode("omni-node", CanvasNodeType.Video),
                metadata: { modelId: "omni-video-minimax-h3-ms-v10", videoMode: "omni" },
            };
            const imgNodes = Array.from({ length: 10 }, (_, i) => makeNode(`img-${i + 1}`, CanvasNodeType.Image));
            const imgConns = imgNodes.slice(0, 9).map((n, i) => makeConnection(`c-img-${i + 1}`, n.id, omniNode.id));
            const allNodes = [omniNode, ...imgNodes];

            const detail = getConnectionRejectionDetail(imgNodes[9].id, omniNode.id, allNodes, imgConns);
            expect(detail).toEqual({
                key: "connectionQuotaImagesExceeded",
                params: { max: 9, current: 9, incoming: 1 },
                defaultMessage: "连接被拒绝：超出参考图上限（该模型最多支持 9 张，当前已有 9 张）",
            });
        });

        it("已存在连线时返回已存在诊断", () => {
            const src = makeNode("src-1", CanvasNodeType.Image);
            const dst = makeNode("dst-1", CanvasNodeType.Image);
            const conn = makeConnection("c-1", src.id, dst.id);

            const detail = getConnectionRejectionDetail(src.id, dst.id, [src, dst], [conn]);
            expect(detail).toEqual({
                key: "connectionAlreadyExists",
                defaultMessage: "连接已存在",
            });
        });

        it("Z-Image Turbo 连入参考图时返回媒体类型不支持诊断", () => {
            const zTurboNode: CanvasNodeData = {
                ...makeNode("turbo-node", CanvasNodeType.Image),
                metadata: { modelId: "image-z-turbo" },
            };
            const imgNode = makeNode("img-1", CanvasNodeType.Image);
            const allNodes = [zTurboNode, imgNode];

            const detail = getConnectionRejectionDetail(imgNode.id, zTurboNode.id, allNodes, []);
            expect(detail).toEqual({
                key: "connectionMediaTypeUnsupported",
                defaultMessage: "连接被拒绝：当前模型不支持参考图",
            });
        });

        it("QRw_D 连第 10 张图时返回配额超限诊断", () => {
            const qwenNode: CanvasNodeData = {
                ...makeNode("qwen-node", CanvasNodeType.Image),
                metadata: { modelId: "image-qwen" },
            };
            const imgNodes = Array.from({ length: 10 }, (_, i) => makeNode(`img-${i + 1}`, CanvasNodeType.Image));
            const imgConns = imgNodes.slice(0, 9).map((n, i) => makeConnection(`c-img-${i + 1}`, n.id, qwenNode.id));
            const allNodes = [qwenNode, ...imgNodes];

            const detail = getConnectionRejectionDetail(imgNodes[9].id, qwenNode.id, allNodes, imgConns);
            expect(detail).toEqual({
                key: "connectionQuotaImagesExceeded",
                params: { max: 9, current: 9, incoming: 1 },
                defaultMessage: "连接被拒绝：超出参考图上限（该模型最多支持 9 张，当前已有 9 张）",
            });
        });

        it("图片节点连入参考视频时返回媒体类型不支持诊断", () => {
            const imgNode: CanvasNodeData = {
                ...makeNode("img-target", CanvasNodeType.Image),
                metadata: { modelId: "image-qwen" },
            };
            const vidNode = makeNode("vid-src", CanvasNodeType.Video);
            const allNodes = [imgNode, vidNode];

            const detail = getConnectionRejectionDetail(vidNode.id, imgNode.id, allNodes, []);
            expect(detail).toEqual({
                key: "connectionMediaTypeUnsupported",
                defaultMessage: "连接被拒绝：当前模型不支持参考视频",
            });
        });
    });
});
