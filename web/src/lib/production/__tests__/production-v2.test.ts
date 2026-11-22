import { describe, expect, it } from "vitest";

import { emptyH3Prompt, mergeAssetH3, parseGeneratedEpisode, validateShot, validateShotConsistency } from "../production-model";
import { deriveStageProgress } from "../production-progress";
import { createEmptyProduction, createProductionEpisode } from "../production-model";
import type { ProductionState, ScriptAsset, ScriptShot } from "@/types/canvas";

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

describe("空间站位锁定", () => {
    it("连续镜头把上一镜头的站位注入提示词", () => {
        const assets = [character("a1", "young woman")];
        const previous = shot({ id: "shot-0", imageVariantIds: ["a1"], blocking: { characterIds: ["a1"], positions: { a1: "画面左侧，背对镜头" }, continuous: true } });
        const current = shot({ id: "shot-1", imageVariantIds: ["a1"], blocking: { characterIds: ["a1"], positions: {}, continuous: true } });
        const merged = mergeAssetH3(current, assets, { previous });
        expect(merged.subject_definitions).toContain("<Subject 1> 站位：画面左侧，背对镜头");
        expect(merged.retention_analysis).toContain("保持与上一镜头一致的站位");
    });

    it("非连续镜头不注入上一镜头的站位", () => {
        const assets = [character("a1", "young woman")];
        const previous = shot({ id: "shot-0", imageVariantIds: ["a1"], blocking: { characterIds: ["a1"], positions: { a1: "画面左侧" }, continuous: true } });
        const current = shot({ id: "shot-1", imageVariantIds: ["a1"], blocking: { characterIds: ["a1"], positions: { a1: "画面右侧" }, continuous: false } });
        const merged = mergeAssetH3(current, assets, { previous });
        expect(merged.subject_definitions).not.toContain("画面左侧");
    });

    it("解析模型输出的站位与一致性声明", () => {
        const assets = [character("a1", "young woman")];
        const parsed = parseGeneratedEpisode(
            JSON.stringify({ episode: { title: "第1集", shots: [{ number: 1, title: "s", duration: 5, size: "1024x1792", imageAssets: ["a1"], blocking: { positions: { a1: "画面左侧" }, continuous: true }, consistency: { carryOverAssetIds: ["a1"], notes: "保持同一件风衣" }, h3: {} }] } }),
            assets,
            "vertical",
        );
        expect(parsed.shots[0].blocking?.positions.a1).toBe("画面左侧");
        expect(parsed.shots[0].blocking?.continuous).toBe(true);
        expect(parsed.shots[0].consistency?.carryOverAssetIds).toEqual(["a1"]);
        expect(parsed.shots[0].consistency?.notes).toBe("保持同一件风衣");
    });
});

describe("一致性校验只提示不阻断", () => {
    it("相邻镜头站位冲突时给出警告", () => {
        const assets = [character("a1", "young woman")];
        const previous = shot({ id: "shot-0", blocking: { characterIds: ["a1"], positions: { a1: "画面左侧" }, continuous: true } });
        const current = shot({ id: "shot-1", blocking: { characterIds: ["a1"], positions: { a1: "画面右侧" }, continuous: false } });
        expect(validateShotConsistency(current, [previous, current], assets).length).toBeGreaterThan(0);
    });

    it("声明继承但未引用时报警告", () => {
        const assets = [character("a1", "young woman")];
        const previous = shot({ id: "shot-0", imageVariantIds: ["a1"] });
        const current = shot({ id: "shot-1", imageVariantIds: [], consistency: { carryOverAssetIds: ["a1"], notes: "" } });
        expect(validateShotConsistency(current, [previous, current], assets).length).toBeGreaterThan(0);
    });

    it("同一资产引用不同形态时报形态漂移警告", () => {
        const assets: ScriptAsset[] = [
            {
                id: "a1",
                kind: "character",
                name: "苏星洛",
                description: "",
                prompt: "",
                variants: [
                    { id: "v1", name: "常服", description: "", prompt: "", h3: {} },
                    { id: "v2", name: "雨夜造型", description: "", prompt: "", h3: {} },
                ],
                h3: {},
            },
        ];
        const previous = shot({ id: "shot-0", imageVariantIds: ["v1"] });
        const current = shot({ id: "shot-1", imageVariantIds: ["v2"] });
        expect(validateShotConsistency(current, [previous, current], assets).length).toBeGreaterThan(0);
    });
});

describe("字幕与 BGM 开关", () => {
    it("关闭 BGM 时配乐段不再必填", () => {
        const assets = [character("a1", "young woman")];
        const current = shot({ imageVariantIds: ["a1"], h3: { ...emptyH3Prompt(), summary: "s", retention_analysis: "r", detailed_description: "d", overall_soundscape: "o" } });
        expect(validateShot(current, assets, "vertical", { subtitle: true, bgm: true }).some((error) => error.includes("non_diegetic_music"))).toBe(true);
        expect(validateShot(current, assets, "vertical", { subtitle: true, bgm: false }).some((error) => error.includes("non_diegetic_music"))).toBe(false);
    });

    it("关闭字幕时移除台词片段", () => {
        const assets: ScriptAsset[] = [];
        const current = shot({ h3: { ...emptyH3Prompt(), detailed_description: "[Shot 1] <d>[Chinese] Li Ming: 「走」</d>", summary: "s", retention_analysis: "r", overall_soundscape: "o", non_diegetic_music: "m" } });
        const merged = mergeAssetH3(current, assets, { options: { subtitle: false, bgm: true } });
        expect(merged.detailed_description).not.toContain("<d>");
    });
});

describe("阶段进度推导", () => {
    const base = (): ProductionState => createEmptyProduction("c1");

    it("没有原文时第一阶段未完成", () => {
        const progress = deriveStageProgress(base());
        expect(progress[0].done).toBe(false);
        expect(progress[0].nextAction.disabled).toBe(true);
    });

    it("多集缺少梗概时大纲阶段未完成", () => {
        const state = base();
        state.source.text = "原文";
        state.setting = "设定";
        state.episodes = [createProductionEpisode(1, "第1集", ""), createProductionEpisode(2, "第2集", "梗概")];
        const progress = deriveStageProgress(state);
        const outline = progress.find((item) => item.stage === "outline");
        expect(outline?.done).toBe(false);
        expect(outline?.count).toBe(1);
        expect(outline?.total).toBe(2);
    });

    it("新建集带梗概", () => {
        const episode = createProductionEpisode(3, "第3集", "本集梗概");
        expect(episode.synopsis).toBe("本集梗概");
    });
});
