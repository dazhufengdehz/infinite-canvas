import { describe, expect, it } from "vitest";
import {
    BUILTIN_IMAGE_WORKFLOW_MODELS,
    evaluateModelAvailability,
    getModelProfile,
    imageMossProfile,
    imageQwen4x4Profile,
    imageQwenProfile,
    imageZTurboProfile,
} from "@/services/api/models";

describe("ImageModelPicker Data Contract & Constraints", () => {
    it("BUILTIN_IMAGE_WORKFLOW_MODELS registers exactly 4 native image models", () => {
        expect(BUILTIN_IMAGE_WORKFLOW_MODELS.map((model) => model.id)).toEqual([
            "image-qwen",
            "image-qwen-4x4",
            "image-moss",
            "image-z-turbo",
        ]);
    });

    it("evaluates QRw_D availability with up to 9 reference images", () => {
        const check9 = evaluateModelAvailability({
            targetModel: imageQwenProfile,
            connectedImages: 9,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "multi-ref composition",
        });
        expect(check9.isAvailable).toBe(true);

        const check10 = evaluateModelAvailability({
            targetModel: imageQwenProfile,
            connectedImages: 10,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "multi-ref composition",
        });
        expect(check10.isAvailable).toBe(false);
        expect(check10.reasons).toContain("已连接 10 张参考图，该模型最多支持 9 张");
    });

    it("evaluates QRw_4x4 as a single-reference image-to-image model", () => {
        const check0 = evaluateModelAvailability({
            targetModel: imageQwen4x4Profile,
            connectedImages: 0,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "style transfer",
        });
        expect(check0.isAvailable).toBe(false);
        expect(check0.isSelectable).toBe(true);
        expect(check0.warningReasons).toContain("该模型至少需要 1 张参考图，当前仅连接 0 张");

        const check1 = evaluateModelAvailability({
            targetModel: imageQwen4x4Profile,
            connectedImages: 1,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "style transfer",
        });
        expect(check1.isAvailable).toBe(true);

        const check2 = evaluateModelAvailability({
            targetModel: imageQwen4x4Profile,
            connectedImages: 2,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "style transfer",
        });
        expect(check2.isAvailable).toBe(false);
        expect(check2.isSelectable).toBe(false);
        expect(check2.reasons).toContain("已连接 2 张参考图，该模型最多支持 1 张");
    });

    it.each([imageMossProfile, imageZTurboProfile])("rejects reference images for $name", (profile) => {
        const result = evaluateModelAvailability({
            targetModel: profile,
            connectedImages: 1,
            connectedVideos: 0,
            connectedAudios: 0,
            promptText: "a cute cat",
        });
        expect(result.isAvailable).toBe(false);
        expect(result.reasons).toContain("该模型不支持参考图，当前已连接 1 张图片");
    });

    it("evaluates media type compatibility", () => {
        const checkVideo = evaluateModelAvailability({
            targetModel: imageQwenProfile,
            connectedImages: 1,
            connectedVideos: 1,
            connectedAudios: 0,
            promptText: "test",
        });
        expect(checkVideo.isAvailable).toBe(false);
        expect(checkVideo.reasons).toContain("该模型不支持参考视频，当前已连接 1 个视频");

        const checkAudio = evaluateModelAvailability({
            targetModel: imageQwenProfile,
            connectedImages: 1,
            connectedVideos: 0,
            connectedAudios: 1,
            promptText: "test",
        });
        expect(checkAudio.isAvailable).toBe(false);
        expect(checkAudio.reasons).toContain("该模型不支持参考音频，当前已连接 1 个音频");
    });

    it("getModelProfile resolves all image models and aliases", () => {
        expect(getModelProfile("image-qwen")).toEqual(imageQwenProfile);
        expect(getModelProfile("t2i")).toEqual(imageQwenProfile);
        expect(getModelProfile("builtin-t2i-qrw-d")).toEqual(imageQwenProfile);
        expect(getModelProfile("builtin-i2i-qrw-d")).toEqual(imageQwenProfile);
        expect(getModelProfile("image-qwen-4x4")).toEqual(imageQwen4x4Profile);
        expect(getModelProfile("i2i")).toEqual(imageQwen4x4Profile);
        expect(getModelProfile("image-moss")).toEqual(imageMossProfile);
        expect(getModelProfile("moss")).toEqual(imageMossProfile);
        expect(getModelProfile("image-z-turbo")).toEqual(imageZTurboProfile);
        expect(getModelProfile("turbo")).toEqual(imageZTurboProfile);
    });
});
