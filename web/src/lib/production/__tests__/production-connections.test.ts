import { describe, expect, it } from "vitest";

import { deriveShotReferences, orderAssetShotConnections, syncShotReferencesFromCanvas } from "../production-connections";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ScriptShot } from "@/types/canvas";

const node = (id: string, type: CanvasNodeType, scriptKey: string): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata: { scriptKey },
});

const connection = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId, kind: "input" });

const shot: ScriptShot = {
    id: "s1",
    number: 1,
    title: "",
    duration: 5,
    size: "1024x1792",
    imageVariantIds: [],
    videoAssetIds: [],
    audioAssetIds: [],
    h3: { subject_definitions: "", summary: "", retention_analysis: "", detailed_description: "", overall_soundscape: "", non_diegetic_music: "" },
};

describe("deriveShotReferences", () => {
    const nodes = [node("n1", CanvasNodeType.Image, "variant:v1"), node("n2", CanvasNodeType.Video, ""), node("n3", CanvasNodeType.Audio, ""), node("shot", CanvasNodeType.Video, "shot:s1")];

    it("按连线顺序派生三类引用", () => {
        const refs = deriveShotReferences("s1", nodes, [connection("n1", "shot"), connection("n2", "shot"), connection("n3", "shot")]);
        expect(refs.imageVariantIds).toEqual(["v1"]);
        expect(refs.videoAssetIds).toEqual(["n2"]);
        expect(refs.audioAssetIds).toEqual(["n3"]);
    });

    it("忽略非托管节点与无效连线", () => {
        const extra = node("free", CanvasNodeType.Image, "");
        const refs = deriveShotReferences("s1", [...nodes, extra], [connection("free", "shot")]);
        expect(refs.imageVariantIds).toEqual([]);
    });

    it("只统计指向该镜头的连线", () => {
        const refs = deriveShotReferences("s1", nodes, [connection("n1", "shot"), connection("n1", "n2")]);
        expect(refs.imageVariantIds).toEqual(["v1"]);
    });
});

describe("syncShotReferencesFromCanvas", () => {
    const nodes = [node("n1", CanvasNodeType.Image, "variant:v1"), node("shot", CanvasNodeType.Video, "shot:s1")];

    it("画布连线变化时返回需要更新的镜头", () => {
        const updates = syncShotReferencesFromCanvas({ episodes: [{ shots: [shot] }] }, nodes, [connection("n1", "shot")]);
        expect(updates.get("s1")?.imageVariantIds).toEqual(["v1"]);
    });

    it("连线与生产态一致时不产生更新", () => {
        const current = { ...shot, imageVariantIds: ["v1"] };
        const updates = syncShotReferencesFromCanvas({ episodes: [{ shots: [current] }] }, nodes, [connection("n1", "shot")]);
        expect(updates.size).toBe(0);
    });
});

describe("orderAssetShotConnections", () => {
    const nodes = [node("n1", CanvasNodeType.Image, "variant:v1"), node("n2", CanvasNodeType.Image, "variant:v2"), node("shot", CanvasNodeType.Video, "shot:s1")];

    it("按引用顺序重排连线", () => {
        const next = orderAssetShotConnections([connection("n1", "shot"), connection("n2", "shot")], nodes, "s1", { imageVariantIds: ["v2", "v1"], videoAssetIds: [], audioAssetIds: [] });
        const order = next.filter((item) => item.toNodeId === "shot").map((item) => item.fromNodeId);
        expect(order).toEqual(["n2", "n1"]);
    });

    it("缺失的连线按稳定 ID 补建", () => {
        const next = orderAssetShotConnections([], nodes, "s1", { imageVariantIds: ["v1"], videoAssetIds: [], audioAssetIds: [] });
        expect(next).toHaveLength(1);
        expect(next[0].id).toBe("production-connection:variant:v1:shot:s1");
    });

    it("保留与镜头无关的连线", () => {
        const other = connection("n2", "n1");
        const next = orderAssetShotConnections([other], nodes, "s1", { imageVariantIds: ["v1"], videoAssetIds: [], audioAssetIds: [] });
        expect(next.some((item) => item.id === other.id)).toBe(true);
    });

    it("移出引用列表的形态连线会被移除", () => {
        const next = orderAssetShotConnections([connection("n1", "shot"), connection("n2", "shot")], nodes, "s1", { imageVariantIds: ["v1"], videoAssetIds: [], audioAssetIds: [] });
        expect(next.filter((item) => item.toNodeId === "shot").map((item) => item.fromNodeId)).toEqual(["n1"]);
    });
});
