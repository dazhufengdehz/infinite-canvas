import type { WorkflowModelProfile } from "./types";

export type ImageResolutionTier = "1k" | "2k" | "4k";
export type ImageAspectRatio = "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "16:9" | "9:16";

export interface ImageDimensionPreset {
    width: number;
    height: number;
}

/**
 * 满足 64 像素整除硬件对齐与同档位面积恒定的 1K / 2K / 4K 分辨率映射表
 * 1K：以 512×512 为 1:1 基准 (约 26 万像素，极速出片)
 * 2K：以 1024×1024 为 1:1 基准 (约 104 万像素，高清标准)
 * 4K：以 2048×2048 为 1:1 基准 (约 419 万像素，超高清精修)
 */
export const IMAGE_RESOLUTION_PRESETS: Record<ImageResolutionTier, Record<ImageAspectRatio, ImageDimensionPreset>> = {
    "1k": {
        "1:1": { width: 512, height: 512 },
        "4:3": { width: 576, height: 448 },
        "3:4": { width: 448, height: 576 },
        "3:2": { width: 640, height: 448 },
        "2:3": { width: 448, height: 640 },
        "16:9": { width: 640, height: 384 },
        "9:16": { width: 384, height: 640 },
    },
    "2k": {
        "1:1": { width: 1024, height: 1024 },
        "4:3": { width: 1152, height: 896 },
        "3:4": { width: 896, height: 1152 },
        "3:2": { width: 1216, height: 832 },
        "2:3": { width: 832, height: 1216 },
        "16:9": { width: 1344, height: 768 },
        "9:16": { width: 768, height: 1344 },
    },
    "4k": {
        "1:1": { width: 2048, height: 2048 },
        "4:3": { width: 2304, height: 1728 },
        "3:4": { width: 1728, height: 2304 },
        "3:2": { width: 2496, height: 1664 },
        "2:3": { width: 1664, height: 2496 },
        "16:9": { width: 2688, height: 1536 },
        "9:16": { width: 1536, height: 2688 },
    },
};

/**
 * 通用生图常用比例预设
 */
export const IMAGE_STANDARD_ASPECT_RATIOS: ImageAspectRatio[] = [
    "1:1",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "16:9",
    "9:16",
];

export const IMAGE_RESOLUTION_TIERS: ImageResolutionTier[] = ["1k", "2k", "4k"];

/**
 * 根据分辨率档位和比例获取具体的宽高
 */
export function getImageDimensions(ratio: ImageAspectRatio | string, tier: ImageResolutionTier = "1k"): ImageDimensionPreset {
    const tierMap = IMAGE_RESOLUTION_PRESETS[tier] || IMAGE_RESOLUTION_PRESETS["1k"];
    const preset = tierMap[ratio as ImageAspectRatio];
    if (preset) return preset;
    return tierMap["1:1"] || { width: 512, height: 512 };
}

/**
 * 从尺寸字符串（如 "512x512", "1344x768", "16:9-2k", "1:1" 等）解析出当前所处的清晰度档位与比例
 */
export function parseImageSizeTierAndRatio(sizeStr?: string): { tier: ImageResolutionTier; ratio: ImageAspectRatio | null; width: number; height: number } {
    const raw = (sizeStr || "").trim().toLowerCase();
    // 1. 精确像素字符串匹配 "512x512"
    const pixelMatch = raw.match(/^(\d+)\s*[x×]\s*(\d+)$/);
    if (pixelMatch) {
        const width = Number(pixelMatch[1]);
        const height = Number(pixelMatch[2]);
        for (const tier of IMAGE_RESOLUTION_TIERS) {
            for (const ratio of IMAGE_STANDARD_ASPECT_RATIOS) {
                const preset = IMAGE_RESOLUTION_PRESETS[tier][ratio];
                if (preset.width === width && preset.height === height) {
                    return { tier, ratio, width, height };
                }
            }
        }
        // 如果不在预设中，根据像素总面积推测最接近的档位
        const area = width * height;
        const tier: ImageResolutionTier = area > 2000000 ? "4k" : area > 600000 ? "2k" : "1k";
        return { tier, ratio: null, width, height };
    }

    // 2. 比例与档位匹配，如 "16:9-2k", "1:1", "4k, 9:16", "9:16 (4k)"
    const tierFirstMatch = raw.match(/^(1k|2k|4k)[\s,_\-:]+(\d+:\d+)$/i);
    if (tierFirstMatch) {
        const tier = tierFirstMatch[1].toLowerCase() as ImageResolutionTier;
        const ratio = tierFirstMatch[2] as ImageAspectRatio;
        const dim = getImageDimensions(ratio, tier);
        return { tier, ratio: IMAGE_STANDARD_ASPECT_RATIOS.includes(ratio) ? ratio : null, width: dim.width, height: dim.height };
    }
    const ratioMatch = raw.match(/^(\d+:\d+)(?:[\s,_\-\(]+(1k|2k|4k)\)?)?$/i);
    if (ratioMatch) {
        const ratio = ratioMatch[1] as ImageAspectRatio;
        const tier = (ratioMatch[2]?.toLowerCase() || "1k") as ImageResolutionTier;
        const dim = getImageDimensions(ratio, tier);
        return { tier, ratio: IMAGE_STANDARD_ASPECT_RATIOS.includes(ratio) ? ratio : null, width: dim.width, height: dim.height };
    }

    // 默认 1K 1:1
    const def = IMAGE_RESOLUTION_PRESETS["1k"]["1:1"];
    return { tier: "1k", ratio: "1:1", width: def.width, height: def.height };
}

const IMAGE_SIZE = {
    parameter: "aspect_ratio",
    values: IMAGE_STANDARD_ASPECT_RATIOS,
    default: "512x512",
    allowCustom: true,
} as const;

const IMAGE_TOOLS = { maskEdit: true, reversePrompt: true } as const;

function imageReferences(minImages: number, maxImages: number) {
    return {
        promptMaxChars: 20000,
        minImages,
        maxImages,
        maskSupported: false,
        minVideos: 0,
        maxVideos: 0,
        maxAudios: 0,
    };
}

export const imageQwenProfile: WorkflowModelProfile = {
    id: "image-qwen",
    name: "Qwen Image 全能生图",
    capability: "image",
    protocol: "comfyui",
    category: "t2i",
    capabilityConfig: { version: 1, references: imageReferences(0, 9), size: IMAGE_SIZE },
    slotMapping: {
        prompt: "prompt",
        seed: "seed",
        width: "width",
        height: "height",
        images: "ref_image_01..09",
        output: "output_image",
    },
    description: "Qwen Image 全能文生图与图生图，最多支持 9 张参考图。",
    supportedTools: IMAGE_TOOLS,
};

export const imageQwen4x4Profile: WorkflowModelProfile = {
    id: "image-qwen-4x4",
    name: "Qwen Image 4×4 图生图",
    capability: "image",
    protocol: "comfyui",
    category: "i2i",
    capabilityConfig: { version: 1, references: imageReferences(1, 1), size: IMAGE_SIZE },
    slotMapping: {
        prompt: "prompt",
        seed: "seed",
        width: "width",
        height: "height",
        images: "ref_image_01",
        output: "output_image",
    },
    description: "Qwen Image 单参考图图生图，可在提示词中使用 @ 引用图片。",
    supportedTools: IMAGE_TOOLS,
};

export const imageMossProfile: WorkflowModelProfile = {
    id: "image-moss",
    name: "Moss Image 文生图",
    capability: "image",
    protocol: "comfyui",
    category: "t2i",
    capabilityConfig: { version: 1, references: imageReferences(0, 0), size: IMAGE_SIZE },
    slotMapping: {
        prompt: "prompt",
        seed: "seed",
        width: "width",
        height: "height",
        output: "output_image",
    },
    description: "Moss Image 文生图工作流。",
    supportedTools: IMAGE_TOOLS,
};

export const imageZTurboProfile: WorkflowModelProfile = {
    id: "image-z-turbo",
    name: "Z-Image-Turbo 文生图",
    capability: "image",
    protocol: "comfyui",
    category: "t2i",
    steps: 8,
    capabilityConfig: { version: 1, references: imageReferences(0, 0), size: IMAGE_SIZE },
    slotMapping: {
        prompt: "prompt",
        seed: "seed",
        width: "width",
        height: "height",
        output: "output_image",
    },
    description: "Z-Image-Turbo 极速文生图，不支持参考图输入。",
    supportedTools: IMAGE_TOOLS,
};

export const IMAGE_WORKFLOW_MODELS: WorkflowModelProfile[] = [
    imageQwenProfile,
    imageQwen4x4Profile,
    imageMossProfile,
    imageZTurboProfile,
];
