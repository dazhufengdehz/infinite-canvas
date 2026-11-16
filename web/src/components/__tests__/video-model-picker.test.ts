import { describe, expect, it } from "vitest";
import {
    BUILTIN_VIDEO_WORKFLOW_MODELS,
    evaluateModelAvailability,
    getModelProfile,
    videoMinimaxH3OmniProfile,
} from "@/services/api/models";
import { isModelSupportedByHost } from "@/stores/use-config-store";
import type { ModelChannel } from "@/types/config";

describe("VideoModelPicker Data Contract", () => {
    it("registers the MS_V10 omni video profile", () => {
        expect(BUILTIN_VIDEO_WORKFLOW_MODELS).toEqual([videoMinimaxH3OmniProfile]);
        expect(videoMinimaxH3OmniProfile.id).toBe("omni-video-minimax-h3-ms-v10");
        expect(videoMinimaxH3OmniProfile.category).toBe("omniVideo");
        expect(videoMinimaxH3OmniProfile.capabilityConfig.references).toMatchObject({
            minImages: 0,
            maxImages: 9,
            minVideos: 0,
            maxVideos: 3,
            maxAudios: 3,
        });
    });

    it("defines duration quick presets and bounds", () => {
        expect(videoMinimaxH3OmniProfile.capabilityConfig.duration).toMatchObject({
            tags: [5, 10, 15],
            default: 5,
            min: 1,
            max: 15,
        });
    });

    it("checks host support using the current profile ID", () => {
        const host: ModelChannel = {
            id: "host-rtx3060",
            name: "RTX 3060 8G 算力机",
            baseUrl: "http://192.168.1.100:8188",
            apiKey: "",
            apiFormat: "comfyui",
            models: [],
            supportedModelIds: ["omni-video-minimax-h3-ms-v10"],
        };
        expect(isModelSupportedByHost(host, videoMinimaxH3OmniProfile.id)).toBe(true);
        expect(isModelSupportedByHost(host, "another-video-profile")).toBe(false);
    });

    it("resolves canonical IDs, workflow IDs and category aliases", () => {
        expect(getModelProfile(videoMinimaxH3OmniProfile.id)).toEqual(videoMinimaxH3OmniProfile);
        expect(getModelProfile("builtin-omni-video-minimax-h3-ms-v10")).toEqual(videoMinimaxH3OmniProfile);
        expect(getModelProfile("omniVideo")).toEqual(videoMinimaxH3OmniProfile);
    });

    it("allows the full 9 images + 3 videos + 3 audios contract", () => {
        const available = evaluateModelAvailability({
            targetModel: videoMinimaxH3OmniProfile,
            connectedImages: 9,
            connectedVideos: 3,
            connectedAudios: 3,
            promptText: "cinematic scene",
        });
        expect(available.isAvailable).toBe(true);
        expect(available.reasons).toEqual([]);

        const overQuota = evaluateModelAvailability({
            targetModel: videoMinimaxH3OmniProfile,
            connectedImages: 10,
            connectedVideos: 4,
            connectedAudios: 4,
            promptText: "cinematic scene",
        });
        expect(overQuota.isAvailable).toBe(false);
        expect(overQuota.reasons).toEqual([
            "已连接 10 张参考图，该模型最多支持 9 张",
            "已连接 4 个参考视频，该模型最多支持 3 个",
            "已连接 4 个参考音频，该模型最多支持 3 个",
        ]);
    });
});
