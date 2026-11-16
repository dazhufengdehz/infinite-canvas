import type { WorkflowModelProfile } from "./types";

/** MiniMax H3 的 32 整数倍尺寸对齐档位（0.4 MP ~ 2.0 MP，共 12 档）。 */
export const MINIMAX_H3_SIZES: string[] = [
    "864x480", "480x864",
    "960x544", "544x960",
    "1056x608", "608x1056",
    "1152x640", "640x1152",
    "1216x672", "672x1216",
    "1280x736", "736x1280",
    "1344x768", "768x1344",
    "1376x768", "768x1376",
    "1504x832", "832x1504",
    "1664x928", "928x1664",
    "1824x1024", "1024x1824",
    "1920x1088", "1088x1920",
];

export function getDslMiddleSize(values?: string[], aspect: "16:9" | "9:16" = "16:9"): string {
    const rawValues = values && values.length > 0 ? values : MINIMAX_H3_SIZES;
    const tierMap = new Map<string, { landscapeW: number; landscapeH: number }>();
    for (const val of rawValues) {
        const match = val.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
        if (!match) continue;
        const w = Number(match[1]);
        const h = Number(match[2]);
        const landscapeW = Math.max(w, h);
        const landscapeH = Math.min(w, h);
        const key = `${landscapeW}x${landscapeH}`;
        if (!tierMap.has(key)) tierMap.set(key, { landscapeW, landscapeH });
    }
    const tiers = Array.from(tierMap.values()).sort((a, b) => (a.landscapeW * a.landscapeH) - (b.landscapeW * b.landscapeH));
    if (tiers.length === 0) return aspect === "16:9" ? "1344x768" : "768x1344";
    const midTier = tiers[Math.floor(tiers.length / 2)];
    return aspect === "16:9" ? `${midTier.landscapeW}x${midTier.landscapeH}` : `${midTier.landscapeH}x${midTier.landscapeW}`;
}

export const videoMinimaxH3OmniProfile: WorkflowModelProfile = {
    id: "omni-video-minimax-h3-ms-v10",
    name: "MiniMax H3 全能参考视频",
    capability: "video",
    protocol: "comfyui",
    category: "omniVideo",
    capabilityConfig: {
        version: 1,
        references: {
            promptMaxChars: 20000,
            minImages: 0,
            maxImages: 9,
            maskSupported: false,
            minVideos: 0,
            maxVideos: 3,
            maxAudios: 3,
        },
        size: {
            parameter: "size",
            values: MINIMAX_H3_SIZES,
            default: getDslMiddleSize(MINIMAX_H3_SIZES, "16:9"),
            allowCustom: false,
        },
        duration: {
            selection: "range",
            min: 1,
            max: 15,
            step: 1,
            tags: [5, 10, 15],
            default: 5,
        },
    },
    slotMapping: {
        prompt: "prompt",
        seed: "seed",
        width: "width",
        height: "height",
        duration: "duration",
        images: "ref_image_01..09",
        videos: "ref_video_01..03",
        audios: "ref_audio_01..03",
        output: "output_video",
    },
    description: "MiniMax H3 MS_V10 全能参考视频，最多支持 9 图 + 3 视频 + 3 音频。",
    supportedTools: { faceRefine: true, depthVideo: true },
};
