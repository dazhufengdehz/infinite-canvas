import { describe, expect, it } from "vitest";
import {
    evaluateModelAvailability,
    HostSupportRule,
    ImageQuotaRule,
    VideoQuotaRule,
    AudioQuotaRule,
    PromptLengthRule,
    type ConstraintContext,
} from "../constraint-engine";
import { imageQwen4x4Profile, imageQwenProfile, videoMinimaxH3OmniProfile } from "../index";
import type { ModelChannel } from "@/stores/use-config-store";

describe("Model Constraint Engine (Specification Pattern)", () => {
    const baseHost: ModelChannel = {
        id: "channel-1",
        name: "本地 3090 算力主机",
        baseUrl: "http://127.0.0.1:8188",
        apiKey: "",
        apiFormat: "comfyui",
        models: [],
        supportedModelIds: [videoMinimaxH3OmniProfile.id],
    };

    it("passes evaluation when all constraints are satisfied", () => {
        const result = evaluateModelAvailability({
            targetModel: videoMinimaxH3OmniProfile,
            connectedImages: 9,
            connectedVideos: 3,
            connectedAudios: 3,
            promptText: "A cinematic scene",
            activeChannel: baseHost,
        });
        expect(result.isAvailable).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    describe("HostSupportRule", () => {
        const rule = new HostSupportRule();

        it("fails when model is not supported by active host", () => {
            const result = rule.check({
                targetModel: imageQwenProfile,
                connectedImages: 0,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
                activeChannel: baseHost,
            });
            expect(result.passed).toBe(false);
            expect(result.reason).toContain("未启用该模型支持");
        });

        it("passes when active host has no supportedModelIds restriction", () => {
            const result = rule.check({
                targetModel: imageQwenProfile,
                connectedImages: 0,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
                activeChannel: { ...baseHost, supportedModelIds: [] },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe("ImageQuotaRule", () => {
        const rule = new ImageQuotaRule();

        it("detects when connected images exceed maxImages", () => {
            const result = rule.check({
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 10,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
            });
            expect(result).toMatchObject({
                passed: false,
                blocking: true,
                reason: "已连接 10 张参考图，该模型最多支持 9 张",
            });
        });

        it("detects missing required images as a non-blocking selection warning", () => {
            const result = rule.check({
                targetModel: imageQwen4x4Profile,
                connectedImages: 0,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
            });
            expect(result).toMatchObject({
                passed: false,
                blocking: false,
                reason: "该模型至少需要 1 张参考图，当前仅连接 0 张",
            });
        });

        it("passes within allowed ranges", () => {
            expect(rule.check({
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 0,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
            }).passed).toBe(true);
            expect(rule.check({
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 9,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
            }).passed).toBe(true);
            expect(rule.check({
                targetModel: imageQwen4x4Profile,
                connectedImages: 1,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "",
            }).passed).toBe(true);
        });
    });

    describe("VideoQuotaRule", () => {
        const rule = new VideoQuotaRule();

        it("rejects video references for models that do not support them", () => {
            const result = rule.check({
                targetModel: imageQwenProfile,
                connectedImages: 1,
                connectedVideos: 1,
                connectedAudios: 0,
                promptText: "",
            });
            expect(result.reason).toBe("该模型不支持参考视频，当前已连接 1 个视频");
        });

        it("rejects when connected videos exceed maxVideos", () => {
            const result = rule.check({
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 1,
                connectedVideos: 4,
                connectedAudios: 0,
                promptText: "",
            });
            expect(result.reason).toBe("已连接 4 个参考视频，该模型最多支持 3 个");
        });
    });

    describe("AudioQuotaRule", () => {
        const rule = new AudioQuotaRule();

        it("rejects audio references for models that do not support them", () => {
            const result = rule.check({
                targetModel: imageQwenProfile,
                connectedImages: 1,
                connectedVideos: 0,
                connectedAudios: 1,
                promptText: "",
            });
            expect(result.reason).toBe("该模型不支持参考音频，当前已连接 1 个音频");
        });

        it("rejects when connected audios exceed maxAudios", () => {
            const result = rule.check({
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 1,
                connectedVideos: 0,
                connectedAudios: 4,
                promptText: "",
            });
            expect(result.reason).toBe("已连接 4 个参考音频，该模型最多支持 3 个");
        });
    });

    describe("PromptLengthRule", () => {
        const rule = new PromptLengthRule();

        it("rejects when prompt length exceeds promptMaxChars", () => {
            const maxChars = videoMinimaxH3OmniProfile.capabilityConfig.references.promptMaxChars || 2000;
            const result = rule.check({
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 0,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "a".repeat(maxChars + 5),
            });
            expect(result.reason).toBe(`提示词字数 (${maxChars + 5}) 超出该模型上限 (${maxChars} 字符)`);
        });

        it("passes when prompt is within promptMaxChars", () => {
            const ctx: ConstraintContext = {
                targetModel: videoMinimaxH3OmniProfile,
                connectedImages: 0,
                connectedVideos: 0,
                connectedAudios: 0,
                promptText: "Valid prompt under limit",
            };
            expect(rule.check(ctx).passed).toBe(true);
        });
    });

    it("collects all diagnostic reasons when multiple rules fail simultaneously", () => {
        const maxChars = imageQwenProfile.capabilityConfig.references.promptMaxChars || 2000;
        const result = evaluateModelAvailability({
            targetModel: imageQwenProfile,
            connectedImages: 10,
            connectedVideos: 1,
            connectedAudios: 1,
            promptText: "x".repeat(maxChars + 100),
            activeChannel: baseHost,
        });
        expect(result.isAvailable).toBe(false);
        expect(result.reasons).toEqual([
            "当前主机「本地 3090 算力主机」未启用该模型支持",
            "已连接 10 张参考图，该模型最多支持 9 张",
            "该模型不支持参考视频，当前已连接 1 个视频",
            "该模型不支持参考音频，当前已连接 1 个音频",
            `提示词字数 (${maxChars + 100}) 超出该模型上限 (${maxChars} 字符)`,
        ]);
    });

    it("keeps input prerequisites selectable while blocking over-quota selection", () => {
        const missing = evaluateModelAvailability({
            targetModel: imageQwen4x4Profile,
            connectedImages: 0,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "",
        });
        expect(missing.isAvailable).toBe(false);
        expect(missing.isSelectable).toBe(true);
        expect(missing.warningReasons).toContain("该模型至少需要 1 张参考图，当前仅连接 0 张");
        expect(missing.blockingReasons).toHaveLength(0);

        const available = evaluateModelAvailability({
            targetModel: imageQwen4x4Profile,
            connectedImages: 1,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "style transfer",
        });
        expect(available.isAvailable).toBe(true);
        expect(available.isSelectable).toBe(true);

        const excess = evaluateModelAvailability({
            targetModel: imageQwen4x4Profile,
            connectedImages: 2,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "",
        });
        expect(excess.isAvailable).toBe(false);
        expect(excess.isSelectable).toBe(false);
        expect(excess.blockingReasons).toContain("已连接 2 张参考图，该模型最多支持 1 张");
    });
});
