import { beforeEach, describe, expect, it } from "vitest";

import {
    COMFYUI_DEFAULT_MODELS,
    DEFAULT_SUPPORTED_IMAGE_MODEL_IDS,
    DEFAULT_SUPPORTED_MODEL_IDS,
    createModelChannel,
    defaultConfig,
    isAiConfigReady,
    isModelSupportedByHost,
    modelCapabilityOf,
    modelOptionLabel,
    modelOptionsFromChannels,
    normalizeApiFormat,
    normalizeChannelModels,
    resolveModelChannel,
    resolveModelForCapability,
    resolveModelRequestConfig,
    selectableModelsByCapability,
    useConfigStore,
    type AiConfig,
    type ComfyWorkflowItem,
    type ModelChannel,
} from "@/stores/use-config-store";

const DEFAULT_MODEL_NAMES = [
    "Qwen Image 全能生图",
    "Qwen Image 4×4 图生图",
    "Moss Image 文生图",
    "Z-Image-Turbo 文生图",
    "Qwen3.5 文本生成与反推",
    "MiniMax H3 全能参考视频",
    "MiniMax Music 03 音乐生成",
];

const DEFAULT_WORKFLOW_IDS = [
    "builtin-t2i-qrw-d",
    "builtin-i2i-qrw-d",
    "builtin-i2i-qrw-4x4",
    "builtin-t2i-moss-image",
    "builtin-t2i-z-image-turbo",
    "builtin-omni-video-minimax-h3-ms-v10",
    "builtin-depth-video-reshot",
    "builtin-text-qwen3-5",
    "builtin-audio-minimax-music-3",
    "builtin-face-refine-h3",
];

describe("COMFYUI_DEFAULT_MODELS", () => {
    it("pre-provisions the seven default ComfyUI models", () => {
        expect(COMFYUI_DEFAULT_MODELS.map((model) => model.name)).toEqual(DEFAULT_MODEL_NAMES);
    });
});

describe("createModelChannel", () => {
    it("pre-provisions the default models for a new ComfyUI channel without models", () => {
        const channel = createModelChannel();
        expect(channel.apiFormat).toBe("comfyui");
        expect(channel.models.map((model) => model.name)).toEqual(DEFAULT_MODEL_NAMES);
    });

    it("keeps an explicit model list instead of pre-provisioning", () => {
        const channel = createModelChannel({ models: [{ name: "My Workflow", capability: "image" }] });
        expect(channel.models.map((model) => model.name)).toEqual(["My Workflow"]);
    });

    it("does not pre-provision when the option is disabled (load path)", () => {
        const channel = createModelChannel({}, { preprovisionComfyuiModels: false });
        expect(channel.models).toEqual([]);
    });
});

describe("normalizeChannelModels", () => {
    it("normalizes string entries with a guessed capability and dedupes by name", () => {
        expect(normalizeChannelModels(["Z-Image-Turbo 文生图", "Z-Image-Turbo 文生图", "Custom T2I"])).toEqual([
            { name: "Z-Image-Turbo 文生图", capability: "image", script: undefined, comfyuiWorkflow: undefined },
            { name: "Custom T2I", capability: "image", script: undefined, comfyuiWorkflow: undefined },
        ]);
    });
});

describe("normalizeApiFormat", () => {
    it("always returns comfyui", () => {
        expect(normalizeApiFormat("gemini")).toBe("comfyui");
        expect(normalizeApiFormat("comfyui")).toBe("comfyui");
        expect(normalizeApiFormat("openai")).toBe("comfyui");
        expect(normalizeApiFormat(undefined)).toBe("comfyui");
    });
});

describe("isAiConfigReady", () => {
    const comfyuiChannel = (overrides: Partial<{ comfyuiProxyUrl: string; comfyuiProxyToken: string }> = {}) =>
        createModelChannel({ baseUrl: "", apiKey: "", models: [], comfyuiProxyUrl: "http://127.0.0.1:8188", comfyuiProxyToken: "secret", ...overrides });

    it("returns true when at least one ComfyUI channel has proxy URL", () => {
        const config: AiConfig = { ...defaultConfig, channels: [comfyuiChannel()] };
        expect(isAiConfigReady(config, "any::model")).toBe(true);
    });

    it("returns false when a ComfyUI channel is missing the proxy URL", () => {
        const config: AiConfig = { ...defaultConfig, channels: [comfyuiChannel({ comfyuiProxyUrl: "" })] };
        expect(isAiConfigReady(config, "any::model")).toBe(false);
    });

    it("returns true when proxy token is empty for native ComfyUI", () => {
        const config: AiConfig = { ...defaultConfig, channels: [comfyuiChannel({ comfyuiProxyToken: "" })] };
        expect(isAiConfigReady(config, "any::model")).toBe(true);
    });

    it("returns false when the model string is empty even if channels are ready", () => {
        const config: AiConfig = { ...defaultConfig, channels: [comfyuiChannel()] };
        expect(isAiConfigReady(config, "")).toBe(false);
    });

    it("is also exposed on the store under the same signature", () => {
        const config: AiConfig = { ...defaultConfig, channels: [comfyuiChannel()] };
        expect(useConfigStore.getState().isAiConfigReady(config, "any::model")).toBe(true);
    });
});

describe("ComfyUI model resolution", () => {
    const comfyChannel: ModelChannel = {
        id: "comfy",
        name: "ComfyUI",
        baseUrl: "",
        apiKey: "",
        apiFormat: "comfyui",
        models: [{ name: "Z-Image-Turbo 文生图", capability: "image", comfyuiWorkflow: { name: "t2i", json: {}, createdAt: 0 } }],
        comfyuiProxyUrl: "http://127.0.0.1:8189",
        comfyuiProxyToken: "tok",
    };
    const config: AiConfig = { ...defaultConfig, channels: [comfyChannel] };

    it("resolves a ComfyUI model to the ComfyUI channel", () => {
        const resolved = resolveModelRequestConfig(config, "comfy::Z-Image-Turbo 文生图");
        expect(resolved.apiFormat).toBe("comfyui");
        expect(resolved.model).toBe("Z-Image-Turbo 文生图");
        expect(resolved.baseUrl).toBe("http://127.0.0.1:8189");
    });

    it("resolves multiple ComfyUI channels to their respective IP addresses", () => {
        const channel1: ModelChannel = {
            ...comfyChannel,
            id: "channel-1",
            name: "ComfyUI 1",
            models: [{ name: "MiniMax H3 全能参考视频", capability: "video" }],
            comfyuiProxyUrl: "http://127.0.0.1:8188",
        };
        const channel2: ModelChannel = {
            ...channel1,
            id: "channel-2",
            name: "ComfyUI 2",
            comfyuiProxyUrl: "http://192.168.1.200:8188",
        };
        const cfg: AiConfig = { ...defaultConfig, channels: [channel1, channel2] };
        expect(resolveModelChannel(cfg, "channel-1::MiniMax H3 全能参考视频").comfyuiProxyUrl).toBe("http://127.0.0.1:8188");
        expect(resolveModelChannel(cfg, "channel-2::MiniMax H3 全能参考视频").comfyuiProxyUrl).toBe("http://192.168.1.200:8188");
    });
});

describe("custom workflow capabilities", () => {
    const channel = createModelChannel({
        id: "custom",
        models: [],
        supportedModelIds: ["image-z-turbo"],
        workflows: [
            { id: "custom-image", name: "自定义图片", category: "t2i", json: {}, createdAt: 0 },
            { id: "custom-video", name: "自定义视频", category: "omniVideo", json: {}, createdAt: 0 },
            { id: "custom-text", name: "自定义文本", category: "text", json: {}, createdAt: 0 },
            { id: "custom-audio", name: "自定义音频", category: "audio", json: {}, createdAt: 0 },
            { id: "image-qwen", name: "重名自定义文本", category: "text", json: {}, createdAt: 0 },
        ],
    });
    const config: AiConfig = { ...defaultConfig, channels: [channel] };

    it("resolves all four capabilities from the exact custom workflow", () => {
        expect(modelCapabilityOf(config, "custom::custom-image")).toBe("image");
        expect(modelCapabilityOf(config, "custom::custom-video")).toBe("video");
        expect(modelCapabilityOf(config, "custom::custom-text")).toBe("text");
        expect(modelCapabilityOf(config, "custom::custom-audio")).toBe("audio");
        expect(resolveModelForCapability(config, "custom::custom-video", "video")).toBe("custom::custom-video");
    });

    it("prefers a custom workflow over a colliding built-in model alias", () => {
        expect(modelCapabilityOf(config, "custom::image-qwen")).toBe("text");
        expect(resolveModelForCapability(config, "custom::image-qwen", "text")).toBe("custom::image-qwen");
    });

    it("allows custom workflows explicitly stored on a restricted host", () => {
        expect(isModelSupportedByHost(channel, "custom-image")).toBe(true);
        expect(isModelSupportedByHost(channel, "custom-video")).toBe(true);
        expect(isModelSupportedByHost(channel, "missing-custom")).toBe(false);
    });
});

describe("persistence merge stability", () => {
    beforeEach(() => {
        useConfigStore.setState({ config: defaultConfig });
    });

    it("preserves custom workflows and proxy URL across merge", () => {
        const customT2i = { name: "custom-t2i.json", json: { test: 1 }, createdAt: 100 };
        const customChannel = createModelChannel({
            id: "default",
            name: "My ComfyUI",
            comfyuiProxyUrl: "http://192.168.1.50:8188",
            comfyuiT2iWorkflow: customT2i,
            workflows: [{ id: "default-t2i-qrw-d", name: customT2i.name, category: "t2i", json: customT2i.json, createdAt: customT2i.createdAt, isDefault: true }],
            models: [{ name: "Z-Image-Turbo 文生图", capability: "image", comfyuiWorkflow: customT2i }],
        });
        const persistOptions = (useConfigStore as any).persist.getOptions();
        const merged = persistOptions.merge({
            config: { ...defaultConfig, channels: [customChannel], imageModel: "default::Z-Image-Turbo 文生图" },
        }, useConfigStore.getState());
        expect(merged.config.channels[0].comfyuiProxyUrl).toBe("http://192.168.1.50:8188");
        expect(merged.config.channels[0].comfyuiT2iWorkflow).toEqual(customT2i);
        expect(merged.config.imageModel).toBe("default::Z-Image-Turbo 文生图");
    });

    it("falls back to current default models when persisted references are obsolete", () => {
        const persistOptions = (useConfigStore as any).persist.getOptions();
        const merged = persistOptions.merge({
            config: {
                ...defaultConfig,
                imageModel: "default::obsolete-gpt-image",
                videoModel: "default::obsolete-video",
                textModel: "default::obsolete-llm",
            },
        }, useConfigStore.getState());
        expect(merged.config.imageModel).toBe("builtin::Qwen Image 全能生图");
        expect(merged.config.videoModel).toBe("builtin::MiniMax H3 全能参考视频");
        expect(merged.config.textModel).toBe("builtin::Qwen3.5 文本生成与反推");
    });

    it("rehydrates after modifying channel via setConfig", async () => {
        const initialChannels = useConfigStore.getState().config.channels;
        const modifiedChannel = { ...initialChannels[0], comfyuiProxyUrl: "http://192.168.1.99:8188" };
        useConfigStore.getState().setConfig({ ...useConfigStore.getState().config, channels: [modifiedChannel] });
        expect(useConfigStore.getState().config.channels[0].comfyuiProxyUrl).toBe("http://192.168.1.99:8188");
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config.channels[0].comfyuiProxyUrl).toBe("http://192.168.1.99:8188");
    });

    it("persists when deleting custom channel", async () => {
        const initialChannels = useConfigStore.getState().config.channels;
        const extraChannel = createModelChannel({ id: "extra", name: "额外渠道" });
        useConfigStore.getState().setConfig({ ...useConfigStore.getState().config, channels: [...initialChannels, extraChannel] });
        expect(useConfigStore.getState().config.channels.length).toBe(2);
        useConfigStore.getState().setConfig({ ...useConfigStore.getState().config, channels: initialChannels });
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config.channels.length).toBe(1);
    });

    it("persists when reordering channels via setDefaultChannel", async () => {
        const initialChannels = useConfigStore.getState().config.channels;
        const extraChannel = createModelChannel({ id: "extra", name: "额外渠道" });
        useConfigStore.getState().setConfig({ ...useConfigStore.getState().config, channels: [extraChannel, initialChannels[0]] });
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config.channels[0].id).toBe("extra");
    });

    it("persists all preferences fields across rehydration", async () => {
        useConfigStore.getState().updateConfig("imageModel", "builtin::Moss Image 文生图");
        useConfigStore.getState().updateConfig("videoModel", "builtin::MiniMax H3 全能参考视频");
        useConfigStore.getState().updateConfig("textModel", "builtin::Qwen3.5 文本生成与反推");
        useConfigStore.getState().updateConfig("canvasImageCount", "5");
        useConfigStore.getState().updateConfig("audioVoice", "echo");
        useConfigStore.getState().updateConfig("audioFormat", "wav");
        useConfigStore.getState().updateConfig("audioSpeed", "1.25");
        useConfigStore.getState().updateConfig("audioInstructions", "Speak in a calm voice");
        useConfigStore.getState().updateConfig("systemPrompt", "You are a professional designer");
        await useConfigStore.persist.rehydrate();
        const config = useConfigStore.getState().config;
        expect(config.imageModel).toBe("builtin::Moss Image 文生图");
        expect(config.model).toBe("builtin::Moss Image 文生图");
        expect(config.videoModel).toBe("builtin::MiniMax H3 全能参考视频");
        expect(config.textModel).toBe("builtin::Qwen3.5 文本生成与反推");
        expect(config.canvasImageCount).toBe("5");
        expect(config.audioVoice).toBe("echo");
        expect(config.audioFormat).toBe("wav");
        expect(config.audioSpeed).toBe("1.25");
        expect(config.audioInstructions).toBe("Speak in a calm voice");
        expect(config.systemPrompt).toBe("You are a professional designer");
    });

    it("persists all WebDAV configuration fields across rehydration", async () => {
        useConfigStore.getState().updateWebdavConfig("url", "https://nas.example.com/webdav");
        useConfigStore.getState().updateWebdavConfig("directory", "my-canvas-backup");
        useConfigStore.getState().updateWebdavConfig("username", "admin");
        useConfigStore.getState().updateWebdavConfig("password", "secret123");
        useConfigStore.getState().updateWebdavConfig("lastSyncedAt", "2026-09-11T12:00:00.000Z");
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().webdav).toMatchObject({
            url: "https://nas.example.com/webdav",
            directory: "my-canvas-backup",
            username: "admin",
            password: "secret123",
            lastSyncedAt: "2026-09-11T12:00:00.000Z",
        });
    });

    it("persists current custom workflow slots and token across rehydration", async () => {
        const customWf = (name: string) => ({ name, json: { node: name }, createdAt: 1000 });
        const channels = useConfigStore.getState().config.channels;
        const modified = {
            ...channels[0],
            comfyuiProxyToken: "my-secret-token",
            comfyuiT2iWorkflow: customWf("custom-t2i"),
            comfyuiI2iWorkflow: customWf("custom-i2i"),
            comfyuiTextWorkflow: customWf("custom-text"),
            comfyuiVideoWorkflow: customWf("custom-video"),
            comfyuiAudioWorkflow: customWf("custom-audio"),
            comfyuiFaceRefineWorkflow: customWf("custom-face-refine"),
            comfyuiDepthVideoWorkflow: customWf("custom-depth-video"),
            workflows: ([
                ["t2i", "t2i-qrw-d", "custom-t2i"],
                ["i2i", "i2i-qrw-d", "custom-i2i"],
                ["text", "text-qwen3-5", "custom-text"],
                ["omniVideo", "omni-video-minimax-h3-ms-v10", "custom-video"],
                ["audio", "audio-minimax-music-3", "custom-audio"],
                ["faceRefine", "face-refine-h3", "custom-face-refine"],
                ["depthVideo", "depth-video-reshot", "custom-depth-video"],
            ] as const).map(([category, suffix, name]) => ({ ...customWf(name), id: `builtin-${suffix}`, category, isDefault: true })),
        };
        useConfigStore.getState().setConfig({ ...useConfigStore.getState().config, channels: [modified] });
        await useConfigStore.persist.rehydrate();
        const savedChannel = useConfigStore.getState().config.channels[0];
        expect(savedChannel.comfyuiProxyToken).toBe("my-secret-token");
        expect(savedChannel.comfyuiT2iWorkflow?.name).toBe("custom-t2i");
        expect(savedChannel.comfyuiI2iWorkflow?.name).toBe("custom-i2i");
        expect(savedChannel.comfyuiTextWorkflow?.name).toBe("custom-text");
        expect(savedChannel.comfyuiVideoWorkflow?.name).toBe("custom-video");
        expect(savedChannel.comfyuiAudioWorkflow?.name).toBe("custom-audio");
        expect(savedChannel.comfyuiFaceRefineWorkflow?.name).toBe("custom-face-refine");
        expect(savedChannel.comfyuiDepthVideoWorkflow?.name).toBe("custom-depth-video");
    });

    it("supports an extra channel, model routing and persistence across reload", async () => {
        const initialChannels = useConfigStore.getState().config.channels;
        const channel2 = createModelChannel({
            id: "chan-2",
            name: "私有 GPU",
            comfyuiProxyUrl: "http://192.168.10.88:8188",
            comfyuiProxyToken: "token2",
        });
        useConfigStore.getState().setConfig({
            ...useConfigStore.getState().config,
            channels: [...initialChannels, channel2],
            models: modelOptionsFromChannels([...initialChannels, channel2]),
        });
        const stateBefore = useConfigStore.getState();
        expect(stateBefore.config.channels.length).toBe(2);
        expect(selectableModelsByCapability(stateBefore.config, "image")).toContain("chan-2::Z-Image-Turbo 文生图");
        expect(modelOptionLabel(stateBefore.config, "chan-2::Z-Image-Turbo 文生图")).toBe("Z-Image-Turbo 文生图（私有 GPU）");
        const reqConfig = resolveModelRequestConfig(stateBefore.config, "chan-2::Z-Image-Turbo 文生图");
        expect(reqConfig.baseUrl).toBe("http://192.168.10.88:8188");
        expect(reqConfig.apiKey).toBe("token2");
        expect(reqConfig.model).toBe("Z-Image-Turbo 文生图");
        expect(resolveModelForCapability(stateBefore.config, "chan-2::Z-Image-Turbo 文生图", "image")).toBe("chan-2::Z-Image-Turbo 文生图");
        await useConfigStore.persist.rehydrate();
        const stateAfter = useConfigStore.getState();
        expect(stateAfter.config.channels.length).toBe(2);
        expect(stateAfter.config.channels.find((channel) => channel.id === "chan-2")).toMatchObject({
            name: "私有 GPU",
            comfyuiProxyUrl: "http://192.168.10.88:8188",
            comfyuiProxyToken: "token2",
        });
        const postReloadReqConfig = resolveModelRequestConfig(stateAfter.config, "chan-2::Z-Image-Turbo 文生图");
        expect(postReloadReqConfig.baseUrl).toBe("http://192.168.10.88:8188");
        expect(postReloadReqConfig.apiKey).toBe("token2");
    });
});

describe("default built-in ComfyUI channel", () => {
    it("provides seven models and ten categorized workflows", () => {
        const channel = defaultConfig.channels[0];
        expect(defaultConfig.channels.map((item) => item.id)).toEqual(["builtin"]);
        expect(channel.name).toBe("系统内置 ComfyUI");
        expect(channel.comfyuiProxyUrl).toBe("http://127.0.0.1:8188");
        expect(channel.models.map((model) => model.name)).toEqual(DEFAULT_MODEL_NAMES);
        expect(channel.workflows?.map((workflow) => workflow.id)).toEqual(DEFAULT_WORKFLOW_IDS);
        expect(channel.workflows?.filter((workflow) => workflow.name === "Qwen Image 全能生图").map((workflow) => workflow.category)).toEqual(["t2i", "i2i"]);
        expect(channel.supportedModelIds).toEqual(DEFAULT_SUPPORTED_MODEL_IDS);
        expect(channel.supportedModelIds).toHaveLength(7);
        expect(DEFAULT_SUPPORTED_IMAGE_MODEL_IDS).toEqual(["image-qwen", "image-qwen-4x4", "image-moss", "image-z-turbo"]);
    });

    it("creates custom channels with the same built-in workflow catalog", () => {
        const customChannel = createModelChannel({ id: "my-custom", name: "自定义 ComfyUI" });
        expect(customChannel.name).toBe("自定义 ComfyUI");
        expect(customChannel.models).toHaveLength(7);
        expect(customChannel.workflows).toHaveLength(10);
        expect(customChannel.supportedModelIds).toHaveLength(7);
        expect(customChannel.workflows?.every((workflow) => workflow.isBuiltin)).toBe(true);
        for (const field of [
            "comfyuiT2iWorkflow",
            "comfyuiI2iWorkflow",
            "comfyuiTextWorkflow",
            "comfyuiVideoWorkflow",
            "comfyuiAudioWorkflow",
            "comfyuiFaceRefineWorkflow",
            "comfyuiDepthVideoWorkflow",
        ] as const) {
            expect(customChannel[field]?.isBuiltin).toBe(true);
        }
    });
});

describe("deleteWorkflowGlobally", () => {
    beforeEach(() => {
        useConfigStore.setState({
            config: {
                ...defaultConfig,
                channels: [
                    defaultConfig.channels[0],
                    createModelChannel({ id: "second", name: "第二渠道" }),
                ],
            },
        });
    });

    it("deletes a built-in workflow across channels and never revives it on merge or rehydrate", async () => {
        const target = defaultConfig.channels[0].workflows!.find((workflow) => workflow.id === "builtin-t2i-qrw-d")!;
        useConfigStore.getState().deleteWorkflowGlobally(target);
        for (const channel of useConfigStore.getState().config.channels) {
            expect(channel.workflows?.some((workflow) => workflow.id.endsWith("t2i-qrw-d"))).toBe(false);
            expect(channel.workflows?.some((workflow) => workflow.id.endsWith("i2i-qrw-d"))).toBe(true);
            expect(channel.deletedBuiltinWorkflowIds).toContain(`${channel.id}-t2i-qrw-d`);
            expect(createModelChannel(channel).workflows?.some((workflow) => workflow.id.endsWith("t2i-qrw-d"))).toBe(false);
        }
        await useConfigStore.persist.rehydrate();
        for (const channel of useConfigStore.getState().config.channels) {
            expect(channel.workflows?.some((workflow) => workflow.id.endsWith("t2i-qrw-d"))).toBe(false);
            expect(channel.workflows?.some((workflow) => workflow.id.endsWith("i2i-qrw-d"))).toBe(true);
        }
    });

    it("deletes a custom workflow across channels and keeps it deleted after rehydrate", async () => {
        const custom: ComfyWorkflowItem = {
            id: "shared-custom-t2i",
            name: "共享自定义工作流",
            category: "t2i",
            json: { node: 1 },
            createdAt: 100,
        };
        useConfigStore.getState().saveWorkflowGlobally(custom);
        expect(useConfigStore.getState().config.channels.every((channel) => channel.workflows?.some((workflow) => workflow.id === custom.id))).toBe(true);
        useConfigStore.getState().deleteWorkflowGlobally(custom);
        expect(useConfigStore.getState().config.channels.every((channel) => channel.workflows?.every((workflow) => workflow.id !== custom.id))).toBe(true);
        expect(useConfigStore.getState().config.channels.every((channel) => channel.workflows?.some((workflow) => workflow.id.endsWith("t2i-qrw-d")))).toBe(true);
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config.channels.every((channel) => channel.workflows?.every((workflow) => workflow.id !== custom.id))).toBe(true);
    });
});

describe("isModelSupportedByHost & updateChannelSupportedModels", () => {
    const channel: ModelChannel = {
        id: "restricted",
        name: "受限渠道",
        baseUrl: "",
        apiKey: "",
        apiFormat: "comfyui",
        models: [],
        supportedModelIds: ["omni-video-minimax-h3-ms-v10", "image-qwen"],
    };

    it("checks explicit support and open-by-default channels", () => {
        expect(isModelSupportedByHost(channel, "omni-video-minimax-h3-ms-v10")).toBe(true);
        expect(isModelSupportedByHost(channel, "image-qwen")).toBe(true);
        expect(isModelSupportedByHost(channel, "image-z-turbo")).toBe(false);
        expect(isModelSupportedByHost({ ...channel, supportedModelIds: [] }, "any-model-id")).toBe(true);
        expect(isModelSupportedByHost({ ...channel, supportedModelIds: undefined }, "any-model-id")).toBe(true);
    });

    it("updates channel supported models in store", () => {
        useConfigStore.setState({ config: defaultConfig });
        useConfigStore.getState().updateChannelSupportedModels("builtin", ["image-z-turbo"]);
        const updated = useConfigStore.getState().config.channels.find((item) => item.id === "builtin");
        expect(updated?.supportedModelIds).toEqual(["image-z-turbo"]);
        expect(isModelSupportedByHost(updated, "image-z-turbo")).toBe(true);
        expect(isModelSupportedByHost(updated, "omni-video-minimax-h3-ms-v10")).toBe(false);
    });
});
