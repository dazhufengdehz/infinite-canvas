import { describe, expect, it } from "vitest";
import { applyTextBindings, findWorkflowStepNode, updateWorkflowNodeInput } from "../../comfyui";
import { getDefaultComfyWorkflowItems } from "../../comfyui-default-workflows";
import {
    BUILTIN_IMAGE_WORKFLOW_MODELS,
    BUILTIN_VIDEO_WORKFLOW_MODELS,
    BUILTIN_TEXT_WORKFLOW_MODELS,
    BUILTIN_WORKFLOW_MODELS,
    buildWorkflowModelProfiles,
    dispatchComfyuiModelWorkflow,
    getModelProfile,
    imageMossProfile,
    imageQwen4x4Profile,
    imageQwenProfile,
    imageZTurboProfile,
    textQwen35Profile,
    listModelsByCapability,
    resolveVideoModelIdForMode,
    resolveVideoModelIdFromWorkflowId,
    validateModelExecution,
    videoMinimaxH3OmniProfile,
    MINIMAX_H3_SIZES,
    getDslMiddleSize,
    IMAGE_RESOLUTION_PRESETS,
    getImageDimensions,
    parseImageSizeTierAndRatio,
} from "../index";

describe("Workflow Model Profiles", () => {
    it("registers the seven built-in generation profiles", () => {
        expect(BUILTIN_VIDEO_WORKFLOW_MODELS).toEqual([videoMinimaxH3OmniProfile]);
        expect(BUILTIN_IMAGE_WORKFLOW_MODELS).toEqual([
            imageQwenProfile,
            imageQwen4x4Profile,
            imageMossProfile,
            imageZTurboProfile,
        ]);
        expect(BUILTIN_TEXT_WORKFLOW_MODELS).toEqual([textQwen35Profile]);
        expect(BUILTIN_WORKFLOW_MODELS).toHaveLength(7);
        expect(listModelsByCapability("video")).toEqual([videoMinimaxH3OmniProfile]);
        expect(listModelsByCapability("image")).toEqual(BUILTIN_IMAGE_WORKFLOW_MODELS);
    });

    it("registers MS_V10 with 9 images + 3 videos + 3 audios and locked size/duration DSL", () => {
        const profile = getModelProfile("omni-video-minimax-h3-ms-v10");
        expect(profile).toEqual(videoMinimaxH3OmniProfile);
        expect(profile?.capability).toBe("video");
        expect(profile?.category).toBe("omniVideo");
        expect(profile?.capabilityConfig.references).toMatchObject({
            minImages: 0,
            maxImages: 9,
            minVideos: 0,
            maxVideos: 3,
            maxAudios: 3,
        });
        expect(profile?.capabilityConfig.size?.values).toEqual(MINIMAX_H3_SIZES);
        expect(profile?.capabilityConfig.size?.values).toHaveLength(24);
        expect(profile?.capabilityConfig.size?.default).toBe("1344x768");
        expect(profile?.capabilityConfig.size?.allowCustom).toBe(false);
        expect(profile?.capabilityConfig.duration).toMatchObject({
            selection: "range",
            min: 1,
            max: 15,
            step: 1,
            tags: [5, 10, 15],
            default: 5,
        });
        expect(profile?.supportedTools).toEqual({ faceRefine: true, depthVideo: true });
    });

    it("deduplicates the shared QRw_D profile by ID while preserving workflow order", () => {
        const workflows = getDefaultComfyWorkflowItems({ id: "builtin" });
        const selected = [
            workflows.find((workflow) => workflow.id === "builtin-i2i-qrw-4x4")!,
            workflows.find((workflow) => workflow.id === "builtin-i2i-qrw-d")!,
            workflows.find((workflow) => workflow.id === "builtin-t2i-qrw-d")!,
            workflows.find((workflow) => workflow.id === "builtin-t2i-moss-image")!,
        ];
        expect(buildWorkflowModelProfiles(selected).map((profile) => profile.id)).toEqual([
            "image-qwen-4x4",
            "image-qwen",
            "image-moss",
        ]);
        expect(buildWorkflowModelProfiles([])).toEqual([]);
    });

    it("resolves current model and workflow IDs", () => {
        expect(getModelProfile("builtin-t2i-qrw-d")).toEqual(imageQwenProfile);
        expect(getModelProfile("builtin-i2i-qrw-d")).toEqual(imageQwenProfile);
        expect(getModelProfile("builtin-i2i-qrw-4x4")).toEqual(imageQwen4x4Profile);
        expect(getModelProfile("builtin-t2i-moss-image")).toEqual(imageMossProfile);
        expect(getModelProfile("builtin-t2i-z-image-turbo")).toEqual(imageZTurboProfile);
        expect(getModelProfile("builtin-omni-video-minimax-h3-ms-v10")).toEqual(videoMinimaxH3OmniProfile);
        expect(getModelProfile("builtin-text-qwen3-5")).toEqual(textQwen35Profile);
        expect(resolveVideoModelIdFromWorkflowId("builtin-omni-video-minimax-h3-ms-v10")).toBe(videoMinimaxH3OmniProfile.id);
        expect(resolveVideoModelIdFromWorkflowId("builtin-t2i-qrw-d")).toBeUndefined();
        expect(resolveVideoModelIdForMode(videoMinimaxH3OmniProfile.id, "omni")).toBe(videoMinimaxH3OmniProfile.id);
        expect(resolveVideoModelIdForMode(videoMinimaxH3OmniProfile.id, "frame")).toBe("");
    });

    it("defines the four image profile reference constraints", () => {
        expect(imageQwenProfile.capabilityConfig.references).toMatchObject({ minImages: 0, maxImages: 9 });
        expect(imageQwen4x4Profile.capabilityConfig.references).toMatchObject({ minImages: 1, maxImages: 1 });
        expect(imageMossProfile.capabilityConfig.references).toMatchObject({ minImages: 0, maxImages: 0 });
        expect(imageZTurboProfile.capabilityConfig.references).toMatchObject({ minImages: 0, maxImages: 0 });
        for (const profile of BUILTIN_IMAGE_WORKFLOW_MODELS) {
            expect(profile.capabilityConfig.size?.default).toBe("512x512");
            expect(profile.supportedTools).toEqual({ maskEdit: true, reversePrompt: true });
        }
    });

    it("resolves text profiles and aliases correctly", () => {
        expect(getModelProfile("text-qwen-35")).toEqual(textQwen35Profile);
        expect(getModelProfile("qwen3.5-4b")).toEqual(textQwen35Profile);
        expect(getModelProfile("text")).toEqual(textQwen35Profile);
        expect(getModelProfile("vlm")).toEqual(textQwen35Profile);
        expect(textQwen35Profile.capabilityConfig.references).toMatchObject({ minImages: 0, maxImages: 1 });
        expect(textQwen35Profile.capabilityConfig.textConfig).toBeUndefined();
    });

    it("computes dynamic middle video sizes for both aspect ratios", () => {
        expect(getDslMiddleSize(MINIMAX_H3_SIZES, "16:9")).toBe("1344x768");
        expect(getDslMiddleSize(MINIMAX_H3_SIZES, "9:16")).toBe("768x1344");
        const oddTiers = ["864x480", "480x864", "1152x640", "640x1152", "1504x832", "832x1504"];
        expect(getDslMiddleSize(oddTiers, "16:9")).toBe("1152x640");
        expect(getDslMiddleSize(oddTiers, "9:16")).toBe("640x1152");
        expect(getDslMiddleSize([], "16:9")).toBe("1344x768");
        expect(getDslMiddleSize(undefined, "9:16")).toBe("768x1344");
        expect(getDslMiddleSize(["invalid"], "16:9")).toBe("1344x768");
    });

    it("verifies 1K / 2K / 4K resolution tiers and 64-pixel alignment presets", () => {
        expect(IMAGE_RESOLUTION_PRESETS["1k"]["1:1"]).toEqual({ width: 512, height: 512 });
        expect(IMAGE_RESOLUTION_PRESETS["1k"]["16:9"]).toEqual({ width: 640, height: 384 });
        expect(IMAGE_RESOLUTION_PRESETS["1k"]["9:16"]).toEqual({ width: 384, height: 640 });
        expect(IMAGE_RESOLUTION_PRESETS["2k"]["1:1"]).toEqual({ width: 1024, height: 1024 });
        expect(IMAGE_RESOLUTION_PRESETS["2k"]["16:9"]).toEqual({ width: 1344, height: 768 });
        expect(IMAGE_RESOLUTION_PRESETS["4k"]["1:1"]).toEqual({ width: 2048, height: 2048 });
        expect(IMAGE_RESOLUTION_PRESETS["4k"]["16:9"]).toEqual({ width: 2688, height: 1536 });
    });

    it("verifies image dimension and size parsing helpers", () => {
        expect(getImageDimensions("1:1", "1k")).toEqual({ width: 512, height: 512 });
        expect(getImageDimensions("16:9", "2k")).toEqual({ width: 1344, height: 768 });
        expect(getImageDimensions("1:1", "4k")).toEqual({ width: 2048, height: 2048 });
        expect(parseImageSizeTierAndRatio("512x512")).toEqual({ tier: "1k", ratio: "1:1", width: 512, height: 512 });
        expect(parseImageSizeTierAndRatio("1344x768")).toEqual({ tier: "2k", ratio: "16:9", width: 1344, height: 768 });
        expect(parseImageSizeTierAndRatio("2688x1536")).toEqual({ tier: "4k", ratio: "16:9", width: 2688, height: 1536 });
        expect(parseImageSizeTierAndRatio("1:1")).toEqual({ tier: "1k", ratio: "1:1", width: 512, height: 512 });
        expect(parseImageSizeTierAndRatio("16:9-2k")).toEqual({ tier: "2k", ratio: "16:9", width: 1344, height: 768 });
    });
});

describe("validateModelExecution (Fail-loud validation)", () => {
    it("enforces the omni video reference limits", () => {
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, {
            imagesCount: 9,
            videosCount: 3,
            audiosCount: 3,
        })).not.toThrow();
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { imagesCount: 10 })).toThrow("最多支持 9 张参考图片");
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { videosCount: 4 })).toThrow("最多支持 3 个参考视频");
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { audiosCount: 4 })).toThrow("最多支持 3 个参考音频");
    });

    it("enforces the four image profile reference limits", () => {
        expect(() => validateModelExecution(imageQwenProfile, { imagesCount: 9 })).not.toThrow();
        expect(() => validateModelExecution(imageQwenProfile, { imagesCount: 10 })).toThrow("最多支持 9 张参考图片");
        expect(() => validateModelExecution(imageQwen4x4Profile, { imagesCount: 0 })).toThrow("至少需要 1 张参考图片");
        expect(() => validateModelExecution(imageQwen4x4Profile, { imagesCount: 2 })).toThrow("最多支持 1 张参考图片");
        for (const profile of [imageMossProfile, imageZTurboProfile]) {
            expect(() => validateModelExecution(profile, { imagesCount: 0 })).not.toThrow();
            expect(() => validateModelExecution(profile, { imagesCount: 1 })).toThrow("最多支持 0 张参考图片");
        }
    });

    it("rejects sizes outside the 12 hardware-aligned tiers", () => {
        for (const size of ["1000x500", "608x352", "736x416"]) {
            expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { size })).toThrow(`不支持尺寸 ${size}`);
        }
        for (const size of ["1280x736", "736x1280", "1920x1088", "1088x1920"]) {
            expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { size })).not.toThrow();
        }
    });

    it("rejects duration outside the 1-15s range", () => {
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { duration: 0 })).toThrow("必须在 1 ~ 15 秒之间");
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { duration: 16 })).toThrow("必须在 1 ~ 15 秒之间");
        expect(() => validateModelExecution(videoMinimaxH3OmniProfile, { duration: 8 })).not.toThrow();
    });
});

describe("dispatchComfyuiModelWorkflow (Cascade Pruning & Parameter Injection)", () => {
    it("injects parameters and prunes unassigned slots in Omni video workflow", () => {
        const rawWorkflow = {
            "1": { inputs: { value: "old prompt" }, class_type: "PrimitiveStringMultiline", _meta: { title: "prompt" } },
            "2": { inputs: { Number: "1024" }, class_type: "Int", _meta: { title: "width" } },
            "3": { inputs: { Number: "1024" }, class_type: "Int", _meta: { title: "height" } },
            "4": { inputs: { value: 5 }, class_type: "PrimitiveFloat", _meta: { title: "duration" } },
            "5": { inputs: { value: 0 }, class_type: "PrimitiveInt", _meta: { title: "seed" } },
            "11": { inputs: { image: "test1.png" }, class_type: "LoadImage", _meta: { title: "ref_image_01" } },
            "12": { inputs: { image: "test2.png" }, class_type: "LoadImage", _meta: { title: "ref_image_02" } },
            "13": { inputs: { image: "test3.png" }, class_type: "LoadImage", _meta: { title: "ref_image_03" } },
            "21": { inputs: { file: "vid1.mp4" }, class_type: "LoadVideo", _meta: { title: "ref_video_01" } },
            "22": { inputs: { video: ["21", 0] }, class_type: "GetVideoComponents" },
            "30": {
                inputs: {
                    prompt: ["1", 0],
                    "ref_images.ref_image_0": ["11", 0],
                    "ref_images.ref_image_1": ["12", 0],
                    "ref_images.ref_image_2": ["13", 0],
                    "ref_videos.ref_video_0": ["22", 0],
                },
                class_type: "MiniMaxOmniSampler",
            },
        };
        const dispatched = dispatchComfyuiModelWorkflow(videoMinimaxH3OmniProfile, rawWorkflow, {
            prompt: "宇宙战舰对轰",
            width: 1280,
            height: 736,
            duration: 10,
            seed: 42,
            assetIds: ["uploaded_img_1.png", "uploaded_img_2.png"],
        });
        expect((dispatched["1"] as any).inputs.value).toBe("宇宙战舰对轰");
        expect((dispatched["2"] as any).inputs.Number).toBe("1280");
        expect((dispatched["3"] as any).inputs.Number).toBe("736");
        expect((dispatched["4"] as any).inputs.value).toBe(10);
        expect((dispatched["5"] as any).inputs.value).toBe(42);
        expect((dispatched["11"] as any).inputs.image).toBe("uploaded_img_1.png");
        expect((dispatched["12"] as any).inputs.image).toBe("uploaded_img_2.png");
        expect(dispatched["13"]).toBeUndefined();
        expect((dispatched["30"] as any).inputs["ref_images.ref_image_2"]).toBeUndefined();
        expect(dispatched["21"]).toBeUndefined();
        expect(dispatched["22"]).toBeUndefined();
        expect((dispatched["30"] as any).inputs["ref_videos.ref_video_0"]).toBeUndefined();
    });

    it("binds parameters and prunes unassigned slots in QRw_D image workflow", () => {
        const rawWorkflow = {
            "1": { inputs: { value: "old prompt" }, class_type: "PrimitiveStringMultiline", _meta: { title: "prompt" } },
            "2": { inputs: { value: 1024 }, class_type: "PrimitiveInt", _meta: { title: "width" } },
            "3": { inputs: { value: 1024 }, class_type: "PrimitiveInt", _meta: { title: "height" } },
            "4": { inputs: { value: 0 }, class_type: "PrimitiveInt", _meta: { title: "seed" } },
            "11": { inputs: { image: "old1.png" }, class_type: "LoadImage", _meta: { title: "ref_image_01" } },
            "12": { inputs: { image: "old2.png" }, class_type: "LoadImage", _meta: { title: "ref_image_02" } },
            "13": { inputs: { image: "old3.png" }, class_type: "LoadImage", _meta: { title: "ref_image_03" } },
            "20": {
                inputs: {
                    "images.image_1": ["11", 0],
                    "images.image_2": ["12", 0],
                    "images.image_3": ["13", 0],
                },
                class_type: "TextEncodeQwenImage21",
            },
            "30": { inputs: { width: 1024, height: 1024 }, class_type: "EmptyLatentImage", _meta: { title: "空Latent图像" } },
            "31": { inputs: { switch: true, on_false: ["20", 2], on_true: ["30", 0] }, class_type: "ComfySwitchNode", _meta: { title: "切换" } },
        };
        const dispatched = dispatchComfyuiModelWorkflow(imageQwenProfile, rawWorkflow, {
            prompt: "赛博朋克雨夜街道",
            width: 768,
            height: 1024,
            seed: 888,
            assetIds: ["new_ref1.png"],
        });
        expect((dispatched["1"] as any).inputs.value).toBe("赛博朋克雨夜街道");
        expect((dispatched["2"] as any).inputs.value).toBe(768);
        expect((dispatched["3"] as any).inputs.value).toBe(1024);
        expect((dispatched["4"] as any).inputs.value).toBe(888);
        expect((dispatched["11"] as any).inputs.image).toBe("new_ref1.png");
        expect(dispatched["12"]).toBeUndefined();
        expect(dispatched["13"]).toBeUndefined();
        expect((dispatched["20"] as any).inputs["images.image_1"]).toEqual(["11", 0]);
        expect((dispatched["20"] as any).inputs["images.image_2"]).toBeUndefined();
        expect((dispatched["20"] as any).inputs["images.image_3"]).toBeUndefined();
        expect((dispatched["31"] as any).inputs.switch).toBe(true);

        const dispatchedNoSize = dispatchComfyuiModelWorkflow(imageQwenProfile, rawWorkflow, {
            prompt: "赛博朋克雨夜街道",
            seed: 888,
            assetIds: ["new_ref1.png"],
        });
        expect((dispatchedNoSize["31"] as any).inputs.switch).toBe(false);

        const t2iDispatched = dispatchComfyuiModelWorkflow(imageQwenProfile, rawWorkflow, {
            prompt: "纯文生图测试",
            width: 768,
            height: 1024,
            seed: 888,
            assetIds: [],
        });
        expect((t2iDispatched["31"] as any).inputs.switch).toBe(true);
    });

    it("applies text bindings cleanly and prunes image node for pure text chat", () => {
        const textWorkflow = {
            "1": { inputs: { value: "old prompt" }, class_type: "PrimitiveStringMultiline", _meta: { title: "prompt" } },
            "2": { inputs: { value: 0 }, class_type: "PrimitiveInt", _meta: { title: "seed" } },
            "3": {
                inputs: { prompt: ["1", 0], image: ["12", 0], max_length: 256, thinking: false },
                class_type: "TextGenerate",
                _meta: { title: "TextGenerate" },
            },
            "12": { inputs: { image: "old.png" }, class_type: "LoadImage", _meta: { title: "ref_image_01" } },
        };
        const bound = applyTextBindings(textWorkflow as any, {
            prompt: "扩写一段关于未来城市的生图提示词",
            seed: 8888,
            maxLength: 1024,
            thinking: true,
        });
        expect((bound["1"] as any).inputs.value).toBe("扩写一段关于未来城市的生图提示词");
        expect((bound["2"] as any).inputs.value).toBe(8888);
        expect(bound["12"]).toBeUndefined();
        expect((bound["3"] as any).inputs.image).toBeUndefined();
        expect((bound["3"] as any).inputs.max_length).toBe(1024);
        expect((bound["3"] as any).inputs.thinking).toBe(true);
    });

    it("applies VLM text bindings with reference image and fallback reverse prompt", () => {
        const textWorkflow = {
            "1": { inputs: { value: "old prompt" }, class_type: "PrimitiveStringMultiline", _meta: { title: "prompt" } },
            "2": { inputs: { value: 0 }, class_type: "PrimitiveInt", _meta: { title: "seed" } },
            "3": {
                inputs: { prompt: ["1", 0], image: ["12", 0], max_length: 256, thinking: false },
                class_type: "TextGenerate",
                _meta: { title: "TextGenerate" },
            },
            "12": { inputs: { image: "old.png" }, class_type: "LoadImage", _meta: { title: "ref_image_01" } },
        };
        const boundCustom = applyTextBindings(textWorkflow as any, {
            prompt: "从参考图中提取赛博朋克光影与主体结构",
            assetId: "uploaded_photo.png",
            seed: 6666,
            maxLength: 512,
            thinking: true,
        });
        expect((boundCustom["1"] as any).inputs.value).toBe("从参考图中提取赛博朋克光影与主体结构");
        expect((boundCustom["2"] as any).inputs.value).toBe(6666);
        expect((boundCustom["12"] as any).inputs.image).toBe("uploaded_photo.png");
        expect((boundCustom["3"] as any).inputs.image).toEqual(["12", 0]);
        expect((boundCustom["3"] as any).inputs.max_length).toBe(512);
        expect((boundCustom["3"] as any).inputs.thinking).toBe(true);

        const boundFallback = applyTextBindings(textWorkflow as any, {
            prompt: "",
            assetId: "uploaded_photo.png",
            seed: 7777,
        });
        expect((boundFallback["1"] as any).inputs.value).toContain("反推一段适合用于 AI 生图的提示词");
        expect((boundFallback["12"] as any).inputs.image).toBe("uploaded_photo.png");
    });

    it("finds and updates strictly matching step slots", () => {
        const wfValid = {
            "10": { inputs: { value: 4 }, class_type: "PrimitiveInt", _meta: { title: "step" } },
            "20": { inputs: { value: 0 }, class_type: "PrimitiveInt", _meta: { title: "seed" } },
        };
        expect(findWorkflowStepNode(wfValid as any)).toMatchObject({ nodeId: "10", title: "step", inputKey: "value", currentValue: 4 });
        const wfNonStrict = {
            "1": { inputs: { value: 4 }, class_type: "PrimitiveInt", _meta: { title: "steps" } },
            "2": { inputs: { value: 4 }, class_type: "PrimitiveInt", _meta: { title: "Step" } },
            "3": { inputs: { value: 4 }, class_type: "PrimitiveInt", _meta: { title: "4步" } },
            "4": { inputs: { steps: ["143", 0] }, class_type: "BasicScheduler", _meta: { title: "step" } },
        };
        expect(findWorkflowStepNode(wfNonStrict as any)).toBeNull();
        const wfDirectScheduler = { "20": { inputs: { steps: 20 }, class_type: "BasicScheduler", _meta: { title: "step" } } };
        expect(findWorkflowStepNode(wfDirectScheduler as any)).toMatchObject({ inputKey: "steps", currentValue: 20 });
        const updated = updateWorkflowNodeInput(wfValid as any, "10", "value", 8);
        expect((updated["10"] as any).inputs.value).toBe(8);
        expect((wfValid["10"] as any).inputs.value).toBe(4);
    });

    it("injects step parameter during dispatch", () => {
        const wf = {
            "5": { inputs: { value: 4 }, class_type: "PrimitiveInt", _meta: { title: "step" } },
            "6": { inputs: { value: "test prompt" }, class_type: "PrimitiveStringMultiline", _meta: { title: "prompt" } },
        };
        const dispatched = dispatchComfyuiModelWorkflow(videoMinimaxH3OmniProfile, wf as any, { prompt: "a majestic mountain", step: 12 });
        expect((dispatched["5"] as any).inputs.value).toBe(12);
        const dispatchedFraction = dispatchComfyuiModelWorkflow(videoMinimaxH3OmniProfile, wf as any, { prompt: "a majestic mountain", step: 7.6 });
        expect((dispatchedFraction["5"] as any).inputs.value).toBe(8);
    });
});
