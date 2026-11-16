import type { ComfyuiWorkflow, ComfyWorkflowItem } from "@/stores/use-config-store";

import qrwDJson from "@/assets/workflows/QRw_D.json";
import qrw4x4Json from "@/assets/workflows/QRw_4×4.json";
import mossImageJson from "@/assets/workflows/moss_image.json";
import zImageTurboJson from "@/assets/workflows/z_image_turbo_api.json";
import msV10Json from "@/assets/workflows/MS_V10.json";
import depthVideoJson from "@/assets/workflows/depth_video_api.json";
import textQwen35Json from "@/assets/workflows/qwen3_5_text_api.json";
import audioMinimaxMusic3Json from "@/assets/workflows/audio_minimax_music_3_api.json";
import faceRefineJson from "@/assets/workflows/H3_Face_Refine_Auto_Select_Api.json";

function builtinWorkflow(name: string, json: Record<string, unknown>): ComfyuiWorkflow {
    return { name, json, createdAt: 0, isBuiltin: true };
}

export const DEFAULT_BUILTIN_COMFYUI_QRW_D_WORKFLOW = builtinWorkflow("Qwen Image 全能生图", qrwDJson as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_QRW_4X4_WORKFLOW = builtinWorkflow("Qwen Image 4×4 图生图", qrw4x4Json as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_MOSS_IMAGE_WORKFLOW = builtinWorkflow("Moss Image 文生图", mossImageJson as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_Z_IMAGE_TURBO_WORKFLOW = builtinWorkflow("Z-Image-Turbo 文生图", zImageTurboJson as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_VIDEO_WORKFLOW = builtinWorkflow("MiniMax H3 全能参考视频", msV10Json as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_DEPTH_VIDEO_WORKFLOW = builtinWorkflow("ReShot 深度视频提取", depthVideoJson as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_TEXT_WORKFLOW = builtinWorkflow("Qwen3.5 文本生成与反推", textQwen35Json as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_AUDIO_WORKFLOW = builtinWorkflow("MiniMax Music 03 音乐生成", audioMinimaxMusic3Json as Record<string, unknown>);
export const DEFAULT_BUILTIN_COMFYUI_FACE_REFINE_WORKFLOW = builtinWorkflow("MiniMax H3 人脸精修", faceRefineJson as Record<string, unknown>);

export type ComfyuiWorkflowBundle = {
    t2i: ComfyuiWorkflow;
    i2i: ComfyuiWorkflow;
    inpaint?: ComfyuiWorkflow;
    text: ComfyuiWorkflow;
    video: ComfyuiWorkflow;
    frameVideo?: ComfyuiWorkflow;
    audio: ComfyuiWorkflow;
    faceRefine: ComfyuiWorkflow;
    depthVideo: ComfyuiWorkflow;
};

export const DEFAULT_BUILTIN_COMFYUI_WORKFLOWS: ComfyuiWorkflowBundle = {
    t2i: DEFAULT_BUILTIN_COMFYUI_QRW_D_WORKFLOW,
    i2i: DEFAULT_BUILTIN_COMFYUI_QRW_D_WORKFLOW,
    text: DEFAULT_BUILTIN_COMFYUI_TEXT_WORKFLOW,
    video: DEFAULT_BUILTIN_COMFYUI_VIDEO_WORKFLOW,
    audio: DEFAULT_BUILTIN_COMFYUI_AUDIO_WORKFLOW,
    faceRefine: DEFAULT_BUILTIN_COMFYUI_FACE_REFINE_WORKFLOW,
    depthVideo: DEFAULT_BUILTIN_COMFYUI_DEPTH_VIDEO_WORKFLOW,
};

export function getDefaultComfyuiWorkflows(): ComfyuiWorkflowBundle {
    return DEFAULT_BUILTIN_COMFYUI_WORKFLOWS;
}

export function getDefaultComfyWorkflowItems(channel?: { id?: string; name?: string } | null): ComfyWorkflowItem[] {
    const prefix = channel?.id || "builtin";
    const item = (
        suffix: string,
        name: string,
        category: ComfyWorkflowItem["category"],
        workflow: ComfyuiWorkflow,
        description: string,
        isDefault = true,
    ): ComfyWorkflowItem => ({
        id: `${prefix}-${suffix}`,
        name,
        category,
        json: workflow.json,
        createdAt: 0,
        isBuiltin: true,
        isDefault,
        description,
    });

    return [
        item("t2i-qrw-d", "Qwen Image 全能生图", "t2i", DEFAULT_BUILTIN_COMFYUI_QRW_D_WORKFLOW, "Qwen Image 全能文生图与多图参考，最多支持 9 张参考图。"),
        item("i2i-qrw-d", "Qwen Image 全能生图", "i2i", DEFAULT_BUILTIN_COMFYUI_QRW_D_WORKFLOW, "Qwen Image 全能图生图与多图参考，最多支持 9 张参考图。"),
        item("i2i-qrw-4x4", "Qwen Image 4×4 图生图", "i2i", DEFAULT_BUILTIN_COMFYUI_QRW_4X4_WORKFLOW, "Qwen Image 单参考图图生图，可在提示词中使用 @ 引用图片。", false),
        item("t2i-moss-image", "Moss Image 文生图", "t2i", DEFAULT_BUILTIN_COMFYUI_MOSS_IMAGE_WORKFLOW, "Moss Image 文生图工作流。", false),
        item("t2i-z-image-turbo", "Z-Image-Turbo 文生图", "t2i", DEFAULT_BUILTIN_COMFYUI_Z_IMAGE_TURBO_WORKFLOW, "Z-Image-Turbo 极速文生图工作流。", false),
        item("omni-video-minimax-h3-ms-v10", "MiniMax H3 全能参考视频", "omniVideo", DEFAULT_BUILTIN_COMFYUI_VIDEO_WORKFLOW, "MiniMax H3 MS_V10 全能参考视频，最多支持 9 图 + 3 视频 + 3 音频。"),
        item("depth-video-reshot", "ReShot 深度视频提取", "depthVideo", DEFAULT_BUILTIN_COMFYUI_DEPTH_VIDEO_WORKFLOW, "单目视频时序连续深度估计工作流。"),
        item("text-qwen3-5", "Qwen3.5 文本生成与反推", "text", DEFAULT_BUILTIN_COMFYUI_TEXT_WORKFLOW, "Qwen3.5 文本生成、提示词扩写与视觉反推工作流。"),
        item("audio-minimax-music-3", "MiniMax Music 03 音乐生成", "audio", DEFAULT_BUILTIN_COMFYUI_AUDIO_WORKFLOW, "MiniMax Music 03 音乐生成工作流。"),
        item("face-refine-h3", "MiniMax H3 人脸精修", "faceRefine", DEFAULT_BUILTIN_COMFYUI_FACE_REFINE_WORKFLOW, "MiniMax H3 视频人脸追踪与自动选择精修工作流。"),
    ];
}
