import { describe, expect, it } from "vitest";

import { buildCustomWorkflowProfile } from "@/services/api/models";
import { applyVideoBindings, detectMiniMaxH3EasyGraph, validateComfyuiWorkflow } from "../comfyui";

type EasyWorkflowOptions = {
    media?: "loader" | "bridge" | "none";
    widthInput?: number | [string, number];
};

function buildEasyWorkflow(options: EasyWorkflowOptions = {}): Record<string, unknown> {
    const mediaKind = options.media ?? "loader";
    const workflow: Record<string, unknown> = {
        "1": { class_type: "MiniMaxH3EasyLoader", inputs: { model: "minimax_h3_ref2va.safetensors" } },
        "2": { class_type: "MiniMaxH3EasyMediaLoader", inputs: { media_state: "" } },
        "3": {
            class_type: "MiniMaxH3Easy",
            inputs: {
                h3_bundle: ["1", 0], mode: "reference", prompt: "", resolution: "480p", aspect_ratio: "16:9",
                width: options.widthInput ?? 1344, height: 768, seconds: 5, advanced: false, fps: 24,
                keyframe_role: "first", ref_image_size: "match", reference_mention_mode: "index",
                prompt_optimizer_settings: false, prompt_optimizer_scene_guide: "none", media: ["2", 0],
            },
        },
        "4": { class_type: "MiniMaxH3EasyOutput", inputs: { h3_context: ["3", 0], model: ["3", 1] } },
        "5": { class_type: "RandomNoise", inputs: { noise_seed: 0 } },
        "6": { class_type: "SaveVideo", inputs: { filename_prefix: "video/canvas", video: ["7", 0] } },
        "7": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 24 } },
        "8": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["3", 3] } },
        "9": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["5", 0] } },
    };

    if (mediaKind === "none") {
        const main = workflow["3"] as { inputs: Record<string, unknown> };
        delete main.inputs.media;
    } else if (mediaKind === "bridge") {
        workflow["20"] = {
            class_type: "MiniMaxH3EasyMediaBridge",
            inputs: { image_count: 2, video_count: 0, audio_count: 0, image_1: ["21", 0], image_2: ["22", 0] },
        };
        workflow["21"] = { class_type: "LoadImage", inputs: { image: "placeholder_1.png" }, _meta: { title: "ref_image_01" } };
        workflow["22"] = { class_type: "LoadImage", inputs: { image: "placeholder_2.png" }, _meta: { title: "ref_image_02" } };
        const main = workflow["3"] as { inputs: Record<string, unknown> };
        main.inputs.media = ["20", 0];
    }
    return workflow;
}

function readMediaState(workflow: Record<string, unknown>) {
    const loader = workflow["2"] as { inputs: Record<string, string> };
    return JSON.parse(loader.inputs.media_state) as {
        images: Array<{ filename: string }>;
        videos: Array<{ filename: string }>;
        audios: Array<{ filename: string }>;
    };
}

describe("MiniMax H3 Easy 插件识别", () => {
    it("按 class_type 定位主节点与媒体加载器，不需要任何 _meta.title", () => {
        expect(detectMiniMaxH3EasyGraph(buildEasyWorkflow())).toEqual({
            mainId: "3", mediaProviderId: "2", mediaProviderKind: "loader", saveVideoId: "6",
        });
    });

    it("主节点的 media 未连接时明确报错", () => {
        const result = validateComfyuiWorkflow(buildEasyWorkflow({ media: "none" }), "omniVideo");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("MiniMaxH3EasyMediaLoader");
    });

    it("不标注 prompt 和 output_video 也能通过视频校验，但不能用作生图", () => {
        expect(validateComfyuiWorkflow(buildEasyWorkflow(), "omniVideo").ok).toBe(true);
        expect(validateComfyuiWorkflow(buildEasyWorkflow(), "frameVideo").ok).toBe(true);
        expect(validateComfyuiWorkflow(buildEasyWorkflow(), "t2i").error).toContain("全能参考视频或首尾帧视频");
    });

    it("Easy Profile 无需槽位标记也提供完整视频参数和媒体配额", () => {
        const profile = buildCustomWorkflowProfile({
            id: "easy", name: "Easy", category: "omniVideo", json: buildEasyWorkflow(), createdAt: 0,
        });
        expect(profile.capabilityConfig.size).toBeDefined();
        expect(profile.capabilityConfig.duration).toBeDefined();
        expect(profile.capabilityConfig.references).toMatchObject({ maxImages: 9, maxVideos: 3, maxAudios: 3 });
    });
});

describe("MiniMax H3 Easy 参数与素材注入", () => {
    it("全能参考写提示词、尺寸、时长、种子和有序 media_state", () => {
        const bound = applyVideoBindings(buildEasyWorkflow(), {
            prompt: "女孩回头看向镜头", assetIds: ["ref_1.png", "ref_2.png"], videoAssetIds: ["ref_video_1.mp4"],
            audioAssetIds: ["ref_audio_1.mp3"], width: 864, height: 480, duration: 10, seed: 42, strictSlots: true,
        });
        const main = bound["3"] as { inputs: Record<string, unknown> };
        expect(main.inputs).toMatchObject({ prompt: "女孩回头看向镜头", width: 864, height: 480, seconds: 10, mode: "reference", resolution: "custom" });
        const state = readMediaState(bound);
        expect(state.images.map((item) => item.filename)).toEqual(["ref_1.png", "ref_2.png"]);
        expect(state.videos.map((item) => item.filename)).toEqual(["ref_video_1.mp4"]);
        expect(state.audios.map((item) => item.filename)).toEqual(["ref_audio_1.mp3"]);
        expect((bound["5"] as { inputs: Record<string, unknown> }).inputs.noise_seed).toBe(42);
    });

    it("首尾帧按顺序写入并切到 image 模式", () => {
        const bound = applyVideoBindings(buildEasyWorkflow(), {
            prompt: "从白天过渡到夜晚", firstFrameAssetId: "first.png", lastFrameAssetId: "last.png",
            videoMode: "frame", width: 480, height: 864, duration: 5, strictSlots: true,
        });
        const main = bound["3"] as { inputs: Record<string, unknown> };
        expect(main.inputs.mode).toBe("image");
        expect(main.inputs.keyframe_role).toBe("first");
        expect(readMediaState(bound).images.map((item) => item.filename)).toEqual(["first.png", "last.png"]);
    });

    it("宽高被 Primitive 接管时改写上游数值而保留连线", () => {
        const workflow = buildEasyWorkflow({ widthInput: ["120", 0] });
        workflow["120"] = { class_type: "Int", inputs: { Number: "1344" } };
        const bound = applyVideoBindings(workflow, { prompt: "测试", width: 544, height: 960, duration: 5 });
        expect((bound["3"] as { inputs: Record<string, unknown> }).inputs.width).toEqual(["120", 0]);
        expect((bound["120"] as { inputs: Record<string, unknown> }).inputs.Number).toBe("544");
    });

    it("媒体桥只更新计数，文件名仍由参考槽位接管", () => {
        const bound = applyVideoBindings(buildEasyWorkflow({ media: "bridge" }), {
            prompt: "两个人走进房间", assetIds: ["ref_1.png"], width: 864, height: 480, duration: 5, strictSlots: true,
        });
        expect((bound["20"] as { inputs: Record<string, unknown> }).inputs).toMatchObject({ image_count: 1, video_count: 0, audio_count: 0 });
        expect((bound["21"] as { inputs: Record<string, unknown> }).inputs.image).toBe("ref_1.png");
    });
});
