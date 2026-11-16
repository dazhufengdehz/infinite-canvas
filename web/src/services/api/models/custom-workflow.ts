import type { ComfyWorkflowItem, ModelChannel, WorkflowCategory } from "@/stores/use-config-store";
import { audioMinimaxMusic3Profile } from "./audio-models";
import { imageQwenProfile } from "./image-models";
import type { WorkflowCapabilityConfig, WorkflowModelProfile } from "./types";
import { videoMinimaxH3OmniProfile } from "./video-minimax-h3-omni";

export const CUSTOM_WORKFLOW_CATEGORIES: Record<"image" | "video" | "audio" | "text", WorkflowCategory[]> = {
    image: ["t2i", "i2i", "inpaint", "superResolve", "angle", "upscale"],
    video: ["omniVideo", "frameVideo"],
    audio: ["audio"],
    text: ["text"],
};

function workflowTitles(workflow: ComfyWorkflowItem) {
    return Object.values(workflow.json).flatMap((node) => {
        if (typeof node !== "object" || node === null) return [];
        const title = (node as { _meta?: { title?: unknown } })._meta?.title;
        return typeof title === "string" && title.trim() ? [title.trim().toLowerCase()] : [];
    });
}

export function isMiniMaxH3EasyWorkflow(workflow: ComfyWorkflowItem) {
    return Object.values(workflow.json).some((node) =>
        typeof node === "object" && node !== null && (node as { class_type?: unknown }).class_type === "MiniMaxH3Easy"
    );
}

export function buildCustomWorkflowProfile(workflow: ComfyWorkflowItem): WorkflowModelProfile {
    const titles = workflowTitles(workflow);
    const slots = new Set(titles);
    const isEasy = isMiniMaxH3EasyWorkflow(workflow);
    const capability = workflow.category === "omniVideo" || workflow.category === "frameVideo" || workflow.category === "faceRefine" || workflow.category === "depthVideo"
        ? "video"
        : workflow.category === "text"
          ? "text"
          : workflow.category === "audio"
            ? "audio"
            : "image";
    const imageCount = titles.filter((title) => /^ref_image(?:_\d+)?$/.test(title)).length;
    const frameCount = Number(slots.has("first_frame")) + Number(slots.has("last_frame"));
    const isInpaint = workflow.category === "inpaint";
    const hasMask = slots.has("ref_mask") || slots.has("mask") || slots.has("ref_mask_01");
    const requiresImage = ["i2i", "superResolve", "angle", "upscale"].includes(workflow.category);
    const references: WorkflowCapabilityConfig["references"] = {
        promptMaxChars: 20000,
        minImages: isInpaint ? 2 : requiresImage ? 1 : 0,
        maxImages: isEasy ? (workflow.category === "frameVideo" ? 2 : 9) : imageCount + frameCount + Number(isInpaint && hasMask),
        minVideos: 0,
        maxVideos: isEasy && workflow.category !== "frameVideo" ? 3 : titles.filter((title) => /^ref_video(?:_\d+)?$/.test(title)).length,
        minAudios: 0,
        maxAudios: isEasy && workflow.category !== "frameVideo" ? 3 : titles.filter((title) => /^ref_audio(?:_\d+)?$/.test(title)).length,
        ...(isInpaint ? { maskSupported: true } : {}),
    };
    const hasSize = isEasy || (slots.has("width") && slots.has("height"));
    const size = hasSize
        ? capability === "video"
            ? videoMinimaxH3OmniProfile.capabilityConfig.size
            : capability === "image"
              ? imageQwenProfile.capabilityConfig.size
              : undefined
        : undefined;
    const duration = isEasy || slots.has("duration")
        ? capability === "video"
            ? videoMinimaxH3OmniProfile.capabilityConfig.duration
            : capability === "audio"
              ? audioMinimaxMusic3Profile.capabilityConfig.duration
              : undefined
        : undefined;

    return {
        id: workflow.id,
        name: workflow.name,
        capability,
        protocol: "comfyui",
        category: workflow.category,
        capabilityConfig: {
            version: 1,
            references,
            ...(size ? { size: { ...size } } : {}),
            ...(duration ? { duration: { ...duration } } : {}),
        },
        slotMapping: {},
        description: workflow.description,
    };
}

export function findCustomWorkflow(
    channel: ModelChannel | undefined,
    workflowId: string | undefined,
    categories?: WorkflowCategory[],
): ComfyWorkflowItem | undefined {
    if (!channel || !workflowId) return undefined;
    return channel.workflows?.find((workflow) =>
        !workflow.isBuiltin && workflow.id === workflowId && (!categories || categories.includes(workflow.category))
    );
}

export function findCustomWorkflowProfile(
    channel: ModelChannel | undefined,
    workflowId: string | undefined,
    categories?: WorkflowCategory[],
): WorkflowModelProfile | undefined {
    const workflow = findCustomWorkflow(channel, workflowId, categories);
    return workflow ? buildCustomWorkflowProfile(workflow) : undefined;
}

export function customWorkflowHasPrompt(workflow: ComfyWorkflowItem) {
    const titles = workflowTitles(workflow);
    return isMiniMaxH3EasyWorkflow(workflow) || titles.some((title) => title === "prompt" || title === "caption" || title === "lyrics");
}
