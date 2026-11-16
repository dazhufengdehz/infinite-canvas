import type { ModelCapabilityType, WorkflowModelProfile } from "./types";
import type { ComfyWorkflowItem } from "@/stores/use-config-store";
import { videoMinimaxH3OmniProfile } from "./video-minimax-h3-omni";
import { buildCustomWorkflowProfile } from "./custom-workflow";
import {
    imageQwenProfile,
    imageQwen4x4Profile,
    imageMossProfile,
    imageZTurboProfile,
    IMAGE_WORKFLOW_MODELS,
} from "./image-models";
import {
    textQwen35Profile,
    TEXT_WORKFLOW_MODELS,
} from "./text-models";
import {
    audioMinimaxMusic3Profile,
    BUILTIN_AUDIO_WORKFLOW_MODELS,
    parseAudioPrompt,
} from "./audio-models";

export * from "./types";
export * from "./video-minimax-h3-omni";
export * from "./image-models";
export * from "./text-models";
export * from "./audio-models";
export * from "./constraint-engine";
export * from "./custom-workflow";

export const BUILTIN_VIDEO_WORKFLOW_MODELS: WorkflowModelProfile[] = [videoMinimaxH3OmniProfile];
export const BUILTIN_IMAGE_WORKFLOW_MODELS: WorkflowModelProfile[] = IMAGE_WORKFLOW_MODELS;
export const BUILTIN_TEXT_WORKFLOW_MODELS: WorkflowModelProfile[] = TEXT_WORKFLOW_MODELS;
export const BUILTIN_AUDIO_WORKFLOW_MODELS_LIST: WorkflowModelProfile[] = BUILTIN_AUDIO_WORKFLOW_MODELS;

export const BUILTIN_WORKFLOW_MODELS: WorkflowModelProfile[] = [
    ...BUILTIN_VIDEO_WORKFLOW_MODELS,
    ...BUILTIN_IMAGE_WORKFLOW_MODELS,
    ...BUILTIN_TEXT_WORKFLOW_MODELS,
    ...BUILTIN_AUDIO_WORKFLOW_MODELS,
];

/**
 * 根据模型 ID 或分类别名获取对应的工作流模型能力 Profile
 */
export function getModelProfile(modelIdOrCategory?: string): WorkflowModelProfile | undefined {
    if (!modelIdOrCategory) return undefined;
    const clean = modelIdOrCategory.includes("::")
        ? modelIdOrCategory.slice(modelIdOrCategory.indexOf("::") + 2).trim()
        : modelIdOrCategory.trim();
    const directMatch = BUILTIN_WORKFLOW_MODELS.find((model) => model.id === clean);
    if (directMatch) return directMatch;

    const workflowDerivedId = resolveModelIdFromWorkflowId(clean);
    if (workflowDerivedId) return BUILTIN_WORKFLOW_MODELS.find((model) => model.id === workflowDerivedId);

    const lower = clean.toLowerCase();
    if (lower === "t2i" || lower === "qwen" || lower === "qwen-image") return imageQwenProfile;
    if (lower === "i2i" || lower === "qwen-4x4") return imageQwen4x4Profile;
    if (lower === "moss" || lower === "moss-image") return imageMossProfile;
    if (lower === "z-turbo" || lower === "turbo" || lower === "z-image") return imageZTurboProfile;
    if (lower === "omni" || lower === "omnivideo") return videoMinimaxH3OmniProfile;
    if (["text", "qwen-35", "qwen3.5", "qwen3.5-4b", "vlm"].includes(lower)) return textQwen35Profile;
    if (["audio", "music", "minimax-music", "minimax_music_3", "minimax-music-3"].includes(lower)) return audioMinimaxMusic3Profile;
    return BUILTIN_WORKFLOW_MODELS.find((model) => model.name.toLowerCase() === lower);
}

/**
 * 依据能力类型列出所有适用的工作流模型
 */
export function listModelsByCapability(capability: ModelCapabilityType): WorkflowModelProfile[] {
    return BUILTIN_WORKFLOW_MODELS.filter((m) => m.capability === capability);
}

const WORKFLOW_MODEL_SUFFIXES: Record<string, string> = {
    "t2i-qrw-d": "image-qwen",
    "i2i-qrw-d": "image-qwen",
    "i2i-qrw-4x4": "image-qwen-4x4",
    "t2i-moss-image": "image-moss",
    "t2i-z-image-turbo": "image-z-turbo",
    "omni-video-minimax-h3-ms-v10": "omni-video-minimax-h3-ms-v10",
    "text-qwen3-5": "text-qwen-35",
    "audio-minimax-music-3": "audio-minimax-music-3",
};

export function resolveModelIdFromWorkflowId(workflowId: string | undefined): string | undefined {
    if (!workflowId) return undefined;
    const suffix = Object.keys(WORKFLOW_MODEL_SUFFIXES).find((key) => workflowId === key || workflowId.endsWith(`-${key}`));
    return suffix ? WORKFLOW_MODEL_SUFFIXES[suffix] : undefined;
}

export function resolveVideoModelIdForMode(currentModelId: string | undefined, nextMode: "omni" | "frame"): string {
    const currentProfile = getModelProfile(currentModelId);
    if (nextMode === "omni") return currentProfile?.category === "omniVideo" ? currentProfile.id : videoMinimaxH3OmniProfile.id;
    return currentProfile?.category === "frameVideo" ? currentProfile.id : "";
}

export function resolveVideoModelIdFromWorkflowId(workflowId: string | undefined): string | undefined {
    const modelId = resolveModelIdFromWorkflowId(workflowId);
    return getModelProfile(modelId)?.capability === "video" ? modelId : undefined;
}

/** 将渠道真实工作流映射为节点 Profile，同一 Profile 的多分类工作流只保留首次出现。 */
export function buildWorkflowModelProfiles(workflows: ComfyWorkflowItem[]): WorkflowModelProfile[] {
    const profiles: WorkflowModelProfile[] = [];
    const seen = new Set<string>();
    for (const workflow of workflows) {
        const profile = workflow.isBuiltin ? getModelProfile(workflow.id) : buildCustomWorkflowProfile(workflow);
        if (!profile || seen.has(profile.id)) continue;
        seen.add(profile.id);
        profiles.push(profile);
    }
    return profiles;
}

export interface ModelValidationParams {
    imagesCount?: number;
    videosCount?: number;
    audiosCount?: number;
    size?: string;
    duration?: number;
}

/**
 * Fail-loud 参数与连线边界校验器：在请求提交前显式拦截不合规参数
 */
export function validateModelExecution(profile: WorkflowModelProfile, params: ModelValidationParams): void {
    const refs = profile.capabilityConfig.references;

    // 1. 图片配额校验
    const imgCount = params.imagesCount ?? 0;
    if (refs.minImages !== undefined && imgCount < refs.minImages) {
        throw new Error(`「${profile.name}」至少需要 ${refs.minImages} 张参考图片，当前仅提供 ${imgCount} 张。`);
    }
    if (refs.maxImages !== undefined && imgCount > refs.maxImages) {
        throw new Error(`「${profile.name}」最多支持 ${refs.maxImages} 张参考图片，当前已连接 ${imgCount} 张，请精简连线。`);
    }

    // 2. 视频配额校验
    const vidCount = params.videosCount ?? 0;
    if (refs.minVideos !== undefined && vidCount < refs.minVideos) {
        throw new Error(`「${profile.name}」至少需要 ${refs.minVideos} 个参考视频，当前仅提供 ${vidCount} 个。`);
    }
    if (refs.maxVideos !== undefined && vidCount > refs.maxVideos) {
        throw new Error(`「${profile.name}」最多支持 ${refs.maxVideos} 个参考视频，当前已连接 ${vidCount} 个，请精简连线。`);
    }

    // 3. 音频配额校验
    const audCount = params.audiosCount ?? 0;
    if (refs.maxAudios !== undefined && audCount > refs.maxAudios) {
        throw new Error(`「${profile.name}」最多支持 ${refs.maxAudios} 个参考音频，当前已连接 ${audCount} 个，请精简连线。`);
    }

    // 4. 尺寸规格校验
    if (params.size && profile.capabilityConfig.size) {
        const sizeConfig = profile.capabilityConfig.size;
        if (!sizeConfig.allowCustom && sizeConfig.values && sizeConfig.values.length > 0) {
            const normalized = params.size.toLowerCase().replace(/\s+/g, "");
            const isAllowed = sizeConfig.values.some((v) => v.toLowerCase().replace(/\s+/g, "") === normalized);
            if (!isAllowed) {
                throw new Error(`「${profile.name}」不支持尺寸 ${params.size}，请从预设的规格中选择。`);
            }
        }
    }

    // 5. 时长区间校验
    if (params.duration !== undefined && profile.capabilityConfig.duration) {
        const durConfig = profile.capabilityConfig.duration;
        if (durConfig.selection === "range") {
            const min = durConfig.min ?? 1;
            const max = durConfig.max ?? 15;
            if (params.duration < min || params.duration > max) {
                const label = profile.capability === "audio" ? "音频时长" : "视频时长";
                throw new Error(`「${profile.name}」${label}必须在 ${min} ~ ${max} 秒之间，当前为 ${params.duration} 秒。`);
            }
        }
    }
}

export interface DispatchedWorkflowParams {
    prompt?: string;
    caption?: string;
    lyrics?: string;
    width?: number;
    height?: number;
    duration?: number;
    seed?: number;
    step?: number;
    steps?: number;
    assetIds?: string[];
    videoAssetIds?: string[];
    audioAssetIds?: string[];
    firstFrameAssetId?: string;
    lastFrameAssetId?: string;
    maskAssetId?: string;
}

type NodeRecord = {
    class_type?: string;
    inputs?: Record<string, unknown>;
    _meta?: { title?: unknown };
};

/**
 * 通用 ComfyUI 协议调度执行器：
 * 依据 WorkflowModelProfile 声明的 slotMapping 与 capabilityConfig，
 * 自动完成参数注入与未指派参考槽位/桥接节点的动态级联修剪（Pruning）。
 */
export function dispatchComfyuiModelWorkflow(
    profile: WorkflowModelProfile,
    rawWorkflow: Record<string, unknown>,
    params: DispatchedWorkflowParams,
): Record<string, unknown> {
    // 提交前严格 Fail-loud 校验
    validateModelExecution(profile, {
        imagesCount: (params.firstFrameAssetId ? 1 : 0) + (params.lastFrameAssetId ? 1 : 0) + (params.maskAssetId ? 1 : 0) + (params.assetIds?.length || 0),
        videosCount: params.videoAssetIds?.length || 0,
        audiosCount: params.audioAssetIds?.length || 0,
        size: params.width && params.height ? `${params.width}x${params.height}` : undefined,
        duration: params.duration,
    });

    const cloned = structuredClone(rawWorkflow) as Record<string, NodeRecord>;

    // Pass 1: 槽位参数注入
    for (const node of Object.values(cloned)) {
        if (typeof node !== "object" || node === null) continue;
        const rawTitle = node._meta?.title;
        const title = typeof rawTitle === "string" ? rawTitle.trim().toLowerCase() : "";
        if (!node.inputs) continue;

        if (title === "prompt" && params.prompt !== undefined) {
            if ("value" in node.inputs) node.inputs.value = params.prompt;
            else if ("text" in node.inputs) node.inputs.text = params.prompt;
            else if ("prompt" in node.inputs) node.inputs.prompt = params.prompt;
        }

        // 音频 caption 与 lyrics 插槽分流
        if (title === "caption" && (params.caption !== undefined || params.prompt !== undefined)) {
            const val = params.caption ?? (params.prompt ? parseAudioPrompt(params.prompt).caption : "");
            if ("value" in node.inputs) node.inputs.value = val;
            else if ("text" in node.inputs) node.inputs.text = val;
            else if ("caption" in node.inputs) node.inputs.caption = val;
        } else if (title === "lyrics" && (params.lyrics !== undefined || params.prompt !== undefined)) {
            const val = params.lyrics ?? (params.prompt ? parseAudioPrompt(params.prompt).lyrics : "");
            if ("value" in node.inputs) node.inputs.value = val;
            else if ("text" in node.inputs) node.inputs.text = val;
            else if ("lyrics" in node.inputs) node.inputs.lyrics = val;
        }

        if (title === "width" && params.width !== undefined) {
            if ("Number" in node.inputs) node.inputs.Number = String(params.width);
            else if ("value" in node.inputs) node.inputs.value = params.width;
            else if ("width" in node.inputs) node.inputs.width = params.width;
        }

        if (title === "height" && params.height !== undefined) {
            if ("Number" in node.inputs) node.inputs.Number = String(params.height);
            else if ("value" in node.inputs) node.inputs.value = params.height;
            else if ("height" in node.inputs) node.inputs.height = params.height;
        }

        if ((title === "duration" || title === "max_duration") && params.duration !== undefined) {
            const offset = profile.durationOffset ?? (profile.id === "audio-minimax-music-3" ? 1 : 0);
            const effectiveDuration = Math.max(1, params.duration + offset);
            if ("Number" in node.inputs) node.inputs.Number = String(effectiveDuration);
            else if ("value" in node.inputs) node.inputs.value = effectiveDuration;
            else if ("duration" in node.inputs) node.inputs.duration = effectiveDuration;
            else if ("max_duration" in node.inputs) node.inputs.max_duration = effectiveDuration;
            else if ("frames" in node.inputs) node.inputs.frames = effectiveDuration;
        }

        if (title === "seed" && params.seed !== undefined) {
            if ("seed" in node.inputs) node.inputs.seed = params.seed;
            else if ("noise_seed" in node.inputs) node.inputs.noise_seed = params.seed;
            else if ("value" in node.inputs) node.inputs.value = params.seed;
        }

        // 采样步数插槽绑定 (严格匹配 _meta.title === "step")
        if (node._meta?.title === "step" && (params.step !== undefined || params.steps !== undefined)) {
            const raw = params.step !== undefined ? params.step : params.steps;
            if (typeof raw === "number" || (typeof raw === "string" && String(raw).trim() !== "")) {
                const stepVal = Math.round(Number(raw));
                if (!isNaN(stepVal)) {
                    if ("value" in node.inputs) node.inputs.value = stepVal;
                    else if ("steps" in node.inputs) node.inputs.steps = stepVal;
                }
            }
        }

        // 首尾帧插槽绑定
        if (title === "first_frame" && params.firstFrameAssetId) {
            node.inputs.image = params.firstFrameAssetId;
        } else if (title === "last_frame" && params.lastFrameAssetId) {
            node.inputs.image = params.lastFrameAssetId;
        }

        // 蒙版插槽绑定 (inpaint)
        if (title === "ref_mask") {
            if (params.maskAssetId) {
                node.inputs.image = params.maskAssetId;
            } else if (params.assetIds && params.assetIds[1]) {
                node.inputs.image = params.assetIds[1];
            }
        }

        // 全能多图参考 (ref_image_01..10)
        if (params.assetIds && params.assetIds.length > 0) {
            const numberedMatch = /^ref_image_(\d{2})$/.exec(title);
            if (numberedMatch) {
                const idx = Number(numberedMatch[1]) - 1;
                if (params.assetIds[idx]) {
                    node.inputs.image = params.assetIds[idx];
                }
            }
        }

        // 全能多视频参考 (ref_video_01..03)
        if (params.videoAssetIds && params.videoAssetIds.length > 0) {
            const numberedMatch = /^ref_video_(0[1-9])$/.exec(title);
            if (numberedMatch) {
                const idx = Number(numberedMatch[1]) - 1;
                if (params.videoAssetIds[idx]) {
                    const assetVal = params.videoAssetIds[idx];
                    if ("file" in node.inputs) node.inputs.file = assetVal;
                    else if ("video" in node.inputs) node.inputs.video = assetVal;
                    else node.inputs.file = assetVal;
                }
            }
        }

        // 全能多音频参考 (ref_audio_01..03)
        if (params.audioAssetIds && params.audioAssetIds.length > 0) {
            const numberedMatch = /^ref_audio_(0[1-9])$/.exec(title);
            if (numberedMatch) {
                const idx = Number(numberedMatch[1]) - 1;
                if (params.audioAssetIds[idx]) {
                    const assetVal = params.audioAssetIds[idx];
                    if ("audio" in node.inputs) node.inputs.audio = assetVal;
                    else if ("file" in node.inputs) node.inputs.file = assetVal;
                    else node.inputs.audio = assetVal;
                }
            }
        }
    }

    // Pass 2: 动态级联修剪（抹除未分配的插槽与桥接转换节点）
    const assignedImageCount = params.assetIds?.length || 0;
    const assignedVideoCount = params.videoAssetIds?.length || 0;
    const assignedAudioCount = params.audioAssetIds?.length || 0;
    const removedNodeIds = new Set<string>();

    for (const [id, node] of Object.entries(cloned)) {
        if (typeof node !== "object" || node === null) continue;
        const rawTitle = node._meta?.title;
        const title = typeof rawTitle === "string" ? rawTitle.trim().toLowerCase() : "";

        if (title === "first_frame" && !params.firstFrameAssetId) {
            removedNodeIds.add(id);
        }
        if (title === "last_frame" && !params.lastFrameAssetId) {
            removedNodeIds.add(id);
        }
        if (title === "ref_mask" && !params.maskAssetId && (!params.assetIds || !params.assetIds[1])) {
            removedNodeIds.add(id);
        }

        const imgMatch = /^ref_image_(\d{2})$/.exec(title);
        if (imgMatch && Number(imgMatch[1]) - 1 >= assignedImageCount) {
            removedNodeIds.add(id);
        }

        const vidMatch = /^ref_video_(0[1-9])$/.exec(title);
        if (vidMatch && Number(vidMatch[1]) - 1 >= assignedVideoCount) {
            removedNodeIds.add(id);
        }

        const audMatch = /^ref_audio_(0[1-9])$/.exec(title);
        if (audMatch && Number(audMatch[1]) - 1 >= assignedAudioCount) {
            removedNodeIds.add(id);
        }
    }

    // Pass 3: 反向修剪桥接节点（如未分配视频的 GetVideoComponents）
    for (const [consumerId, node] of Object.entries(cloned)) {
        if (removedNodeIds.has(consumerId)) continue;
        if (!node.inputs) continue;
        for (const [inputKey, val] of Object.entries(node.inputs)) {
            if (!Array.isArray(val)) continue;
            const upstreamId = String(val[0]);
            const upstreamNode = cloned[upstreamId];
            if (!upstreamNode) continue;

            if (upstreamNode.class_type === "GetVideoComponents") {
                const videoInput = upstreamNode.inputs?.video;
                if (Array.isArray(videoInput) && removedNodeIds.has(String(videoInput[0]))) {
                    delete node.inputs[inputKey];
                    removedNodeIds.add(upstreamId);
                }
            }

            let shouldPrune = false;
            const imgIn = /^ref_images\.ref_image_(\d+)$/.exec(inputKey);
            if (imgIn && Number(imgIn[1]) >= assignedImageCount) shouldPrune = true;
            const vidIn = /^ref_videos\.ref_video_(\d+)$/.exec(inputKey);
            if (vidIn && Number(vidIn[1]) >= assignedVideoCount) shouldPrune = true;
            const audIn = /^ref_audios\.ref_audio_(\d+)$/.exec(inputKey);
            if (audIn && Number(audIn[1]) >= assignedAudioCount) shouldPrune = true;

            if (shouldPrune) {
                delete node.inputs[inputKey];
                removedNodeIds.add(upstreamId);
            }
        }
    }

    // 彻底从执行图删除标记节点与下游断链引用
    for (const id of removedNodeIds) {
        delete cloned[id];
    }
    for (const node of Object.values(cloned)) {
        if (!node.inputs) continue;
        for (const [key, val] of Object.entries(node.inputs)) {
            if (Array.isArray(val) && removedNodeIds.has(String(val[0]))) {
                delete node.inputs[key];
            }
        }
    }

    // Pass 4: 动态切换潜空间路由开关（例如文生图与图生图/多图参考切换的 ComfySwitchNode）
    const hasCustomSize = params.width !== undefined && params.height !== undefined;
    for (const node of Object.values(cloned)) {
        if (typeof node !== "object" || node === null) continue;
        if (node.class_type === "ComfySwitchNode" && node.inputs) {
            const onTrue = node.inputs.on_true;
            const onFalse = node.inputs.on_false;
            if (Array.isArray(onTrue) && Array.isArray(onFalse)) {
                const trueTargetId = String(onTrue[0]);
                const falseTargetId = String(onFalse[0]);
                const trueTargetNode = cloned[trueTargetId];
                const falseTargetNode = cloned[falseTargetId];

                const trueIsEmptyLatent = Boolean(trueTargetNode?.class_type?.includes("EmptyLatent"));
                const falseIsEmptyLatent = Boolean(falseTargetNode?.class_type?.includes("EmptyLatent"));

                if (trueIsEmptyLatent && !falseIsEmptyLatent) {
                    node.inputs.switch = hasCustomSize || assignedImageCount === 0;
                } else if (falseIsEmptyLatent && !trueIsEmptyLatent) {
                    node.inputs.switch = !hasCustomSize && assignedImageCount > 0;
                }
            }
        }
    }

    return cloned;
}
