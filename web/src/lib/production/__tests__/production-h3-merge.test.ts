import { describe, expect, it } from "vitest";

import { emptyH3Prompt, mergeAssetH3, parseGeneratedAssets, validateShot } from "../production-model";
import type { ScriptAsset, ScriptShot } from "@/types/canvas";

/** 构造一个只有单个形态的角色资产，形态 ID 与资产 ID 相同。 */
const character = (id: string, subject: string, extra: Partial<ScriptAsset["h3"]> = {}): ScriptAsset => ({
    id,
    kind: "character",
    name: id,
    description: "",
    prompt: "",
    variants: [{ id, name: "", description: "", prompt: "", h3: {} }],
    h3: { subject_definitions: subject, ...extra },
});

const shot = (overrides: Partial<ScriptShot> = {}): ScriptShot => ({
    id: "shot-1",
    number: 1,
    title: "镜头",
    duration: 5,
    size: "1024x1792",
    imageVariantIds: [],
    videoAssetIds: [],
    audioAssetIds: [],
    h3: emptyH3Prompt(),
    ...overrides,
});

describe("mergeAssetH3", () => {
    it("按连线顺序注入 <Subject N> is <Picture N> 绑定", () => {
        const assets = [character("a1", "young woman with a high ponytail"), character("a2", "an old man in a grey coat")];
        const merged = mergeAssetH3(shot({ imageVariantIds: ["a1", "a2"] }), assets);
        expect(merged.subject_definitions).toContain("<Subject 1> is <Picture 1>: young woman with a high ponytail");
        expect(merged.subject_definitions).toContain("<Subject 2> is <Picture 2>: an old man in a grey coat");
    });

    it("镜头已写过的参考对象不被资产重复追加", () => {
        const assets = [character("a1", "asset description")];
        const current = shot({ imageVariantIds: ["a1"], h3: { ...emptyH3Prompt(), subject_definitions: "<Subject 1> is <Picture 1>, wearing a red dress." } });
        const merged = mergeAssetH3(current, assets);
        expect(merged.subject_definitions).not.toContain("asset description");
    });

    it("镜头未覆盖的参考对象仍会被资产补齐", () => {
        const assets = [character("a1", "asset one"), character("a2", "asset two")];
        const current = shot({ imageVariantIds: ["a1", "a2"], h3: { ...emptyH3Prompt(), subject_definitions: "<Subject 1> is <Picture 1>, wearing a red dress." } });
        const merged = mergeAssetH3(current, assets);
        expect(merged.subject_definitions).toContain("<Subject 2> is <Picture 2>: asset two");
        expect(merged.subject_definitions).not.toContain("asset one");
    });

    it("只合并该资产类型允许贡献的字段", () => {
        const assets = [character("a1", "subject text", { non_diegetic_music: "should be ignored" })];
        const merged = mergeAssetH3(shot({ imageVariantIds: ["a1"] }), assets);
        expect(merged.non_diegetic_music).toBe("");
    });

    it("没有 H3 字段的资产不影响镜头原文", () => {
        const assets: ScriptAsset[] = [{ id: "a1", kind: "character", name: "a1", description: "", prompt: "", variants: [{ id: "a1", name: "", description: "", prompt: "", h3: {} }], h3: {} }];
        const current = shot({ imageVariantIds: ["a1"], h3: { ...emptyH3Prompt(), summary: "a summary" } });
        expect(mergeAssetH3(current, assets).summary).toBe("a summary");
    });

    it("形态自身的 H3 字段覆盖资产级基线", () => {
        const assets: ScriptAsset[] = [
            {
                id: "a1",
                kind: "character",
                name: "a1",
                description: "",
                prompt: "",
                variants: [{ id: "v1", name: "雨夜造型", description: "", prompt: "", h3: { subject_definitions: "wearing a raincoat" } }],
                h3: { subject_definitions: "young woman" },
            },
        ];
        const merged = mergeAssetH3(shot({ imageVariantIds: ["v1"] }), assets);
        expect(merged.subject_definitions).toContain("wearing a raincoat");
        expect(merged.subject_definitions).not.toContain("young woman");
    });
});

describe("parseGeneratedAssets", () => {
    it("解析资产上的 h3 参考字段", () => {
        const assets = parseGeneratedAssets(JSON.stringify({ assets: [{ kind: "character", name: "苏星洛", description: "d", prompt: "p", h3: { subject_definitions: "young woman", retention_analysis: "keep face" } }] }));
        expect(assets[0].h3.subject_definitions).toBe("young woman");
        expect(assets[0].h3.retention_analysis).toBe("keep face");
    });

    it("缺少 h3 时给出空对象", () => {
        const assets = parseGeneratedAssets(JSON.stringify({ assets: [{ kind: "prop", name: "red envelope", description: "d", prompt: "p" }] }));
        expect(assets[0].h3).toEqual({});
    });

    it("解析资产形态并分配独立 ID", () => {
        const assets = parseGeneratedAssets(JSON.stringify({ assets: [{ kind: "character", name: "苏星洛", description: "d", prompt: "p", variants: [{ name: "常服", description: "日常", prompt: "p1" }, { name: "雨夜造型", description: "雨中", prompt: "p2" }] }] }));
        expect(assets[0].variants).toHaveLength(2);
        expect(assets[0].variants[0].name).toBe("常服");
        expect(assets[0].variants[0].id).not.toBe(assets[0].variants[1].id);
    });

    it("没有形态时补一个默认形态", () => {
        const assets = parseGeneratedAssets(JSON.stringify({ assets: [{ kind: "prop", name: "red envelope", description: "d", prompt: "p" }] }));
        expect(assets[0].variants).toHaveLength(1);
        expect(assets[0].variants[0].prompt).toBe("p");
    });
});

describe("validateShot", () => {
    it("资产的 H3 字段可以满足镜头字段的非空要求", () => {
        const assets = [character("a1", "young woman")];
        const current = shot({ imageVariantIds: ["a1"], h3: { ...emptyH3Prompt(), summary: "s", retention_analysis: "r", detailed_description: "d", overall_soundscape: "o", non_diegetic_music: "m" } });
        expect(validateShot(current, assets, "vertical").filter((error) => error.includes("subject_definitions"))).toEqual([]);
    });

    it("资产与镜头都没有该字段时仍然报错", () => {
        const assets = [character("a1", "young woman")];
        const current = shot({ imageVariantIds: ["a1"], h3: { ...emptyH3Prompt(), summary: "s", retention_analysis: "r", detailed_description: "d", overall_soundscape: "o" } });
        expect(validateShot(current, assets, "vertical").some((error) => error.includes("non_diegetic_music"))).toBe(true);
    });

    it("引用不存在的形态时报错", () => {
        const assets = [character("a1", "young woman")];
        const current = shot({ imageVariantIds: ["missing"], h3: { ...emptyH3Prompt(), summary: "s", retention_analysis: "r", detailed_description: "d", overall_soundscape: "o", non_diegetic_music: "m" } });
        expect(validateShot(current, assets, "vertical").length).toBeGreaterThan(0);
    });
});

describe("用户上传的参考媒体编号", () => {
    it("参考视频与音频没有资产文本时仍保留编号绑定", () => {
        const merged = mergeAssetH3(shot({ videoAssetIds: ["v-node"], audioAssetIds: ["a-node"] }), []);
        expect(merged.detailed_description).toContain("<Video 1>");
        expect(merged.overall_soundscape).toContain("<Audio 1>");
    });

    it("编号与参考数量连续对应", () => {
        const merged = mergeAssetH3(shot({ videoAssetIds: ["v1", "v2"] }), []);
        expect(merged.detailed_description).toContain("<Video 2>");
        expect(merged.detailed_description).not.toContain("<Video 3>");
    });
});
