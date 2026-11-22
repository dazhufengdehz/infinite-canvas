import type { ModelSupportedTools } from "@/services/api/models/types";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { Asset } from "@/stores/use-asset-store";

/** 资产大类：只有角色、场景、道具三类，参考视频与参考音频不再作为资产存在。 */
export type ScriptAssetKind = "character" | "scene" | "prop";

/**
 * 资产形态：同一资产（角色/场景/道具）下的一个具体形象。
 * 每个形态独立对应一个画布节点，镜头引用的是形态 ID。
 */
export type ScriptAssetVariant = {
    id: string;
    /** 形态名，如「常服」「雨夜造型」「破损状态」。 */
    name: string;
    /** 形态描述：与原形态的差异。 */
    description: string;
    /** 图像生成提示词；为空时继承资产自身的 prompt。 */
    prompt: string;
    /** 该形态的 H3 参考字段模板，不含任何编号。 */
    h3: Partial<ScriptH3Prompt>;
};

/**
 * 剧本资产：一个角色/场景/道具，可包含多个形态。
 * 参考音频已移除；角色的音色参考由用户在画布上手动上传音频节点并连线。
 */
export type ScriptAsset = {
    id: string;
    kind: ScriptAssetKind;
    name: string;
    description: string;
    /** 资产的基础图像生成提示词。 */
    prompt: string;
    /** 该资产的形态列表；至少保留一个默认形态。 */
    variants: ScriptAssetVariant[];
    /** 资产级别的 H3 参考字段模板，作为所有形态的公共基线。 */
    h3: Partial<ScriptH3Prompt>;
    /** 角色音色参考：指向画布上的音频节点 ID，由用户上传，非必填。 */
    voiceNodeId?: string;
};

/** 单个 H3 镜头提示词的六段结构。 */
export type ScriptH3Prompt = {
    subject_definitions: string;
    summary: string;
    retention_analysis: string;
    detailed_description: string;
    overall_soundscape: string;
    non_diegetic_music: string;
};

/** 单镜头的空间站位：人物相对画面与彼此的位置，跨镜头衔接时锁定。 */
export type ShotBlocking = {
    /** 参与站位的角色资产 ID（形态 ID 优先），与 imageVariantIds 对齐。 */
    characterIds: string[];
    /** 每个角色的站位描述，如「画面左侧，背对镜头」。 */
    positions: Record<string, string>;
    /** 是否与上一镜头存在剧情衔接，需要保持站位连续。 */
    continuous: boolean;
};

/** 跨镜头一致性声明。 */
export type ShotConsistency = {
    /** 必须与前镜头保持一致的资产 ID。 */
    carryOverAssetIds: string[];
    /** 一致性备注，写入 H3 retention_analysis。 */
    notes: string;
};

/** 结构化镜头：参数与有序引用随镜头保存，画布节点由 production-nodes 派生。 */
export type ScriptShot = {
    id: string;
    number: number;
    title: string;
    duration: number;
    size: string;
    /** 有序引用：第一个对应 <Picture 1>，引用的是形态 ID。 */
    imageVariantIds: string[];
    /** 参考视频节点 ID，由用户手动连线产生。 */
    videoAssetIds: string[];
    /** 参考音频节点 ID：角色的音色参考，由用户手动连线产生。 */
    audioAssetIds: string[];
    h3: ScriptH3Prompt;
    /** 空间站位：跨镜头衔接时锁定的角色位置。 */
    blocking?: ShotBlocking;
    /** 跨镜头一致性声明。 */
    consistency?: ShotConsistency;
};

/** 生产链路参数：画幅、集数、单集时长与题材等创作约束。 */
export type ProductionOptions = {
    episodes: number;
    duration: number;
    genre: string;
    audience: string;
    orientation: "vertical" | "horizontal";
    keep?: string;
    change?: string;
    /** 是否在 H3 提示词中保留台词文本（字幕）。 */
    subtitle: boolean;
    /** 是否在 H3 提示词中要求非叙事配乐段（BGM）。 */
    bgm: boolean;
};

/** 批量生成配置：工作流与参数覆盖，作用于「生成所有资产 / 所有分镜」。 */
export type ProductionBatchConfig = {
    /** 资产图片工作流 ID；空表示用渠道默认。 */
    assetWorkflowId: string;
    /** 镜头视频工作流 ID；空表示用渠道默认。 */
    shotWorkflowId: string;
    /** 资产图片尺寸覆盖；空表示用节点自身。 */
    assetSize: string;
    /** 镜头时长覆盖（秒）；0 表示用镜头自身。 */
    shotSeconds: number;
    /** 固定种子；-1 表示随机。 */
    seed: number;
};

export type ProductionChapter = { title: string; content: string };

/** 集是生产聚合根：自带大纲、正文与分镜，避免多处数组按下标对齐。 */
export type ProductionEpisode = {
    id: string;
    number: number;
    title: string;
    synopsis: string;
    script: string;
    shots: ScriptShot[];
};

/** 项目级生产数据（version 1）：结构化资产与分镜是唯一权威，媒体仍在画布节点上。 */
export type ProductionState = {
    version: 1;
    updatedAt: string;
    canvasId: string;
    options: ProductionOptions;
    source: { text: string; condensed: string; chapters: ProductionChapter[] };
    setting: string;
    assets: ScriptAsset[];
    episodes: ProductionEpisode[];
    /** 批量生成的工作流与参数覆盖。 */
    batch: ProductionBatchConfig;
};

export type CanvasProject = {
    id: string;
    schemaVersion: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    activeCanvasId: string | null;
    /** 项目级生产数据：原文、设定、资产与分集分镜的唯一权威。 */
    production?: ProductionState;
};

export type CanvasDocument = {
    id: string;
    schemaVersion: number;
    projectId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDocumentPatch = Partial<Pick<CanvasDocument, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>;

export type CanvasDocumentSummary = {
    id: string;
    projectId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodeCount: number;
    connectionCount: number;
};

export type CanvasProjectSummary = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    canvasCount: number;
    nodeCount: number;
    connectionCount: number;
    assetCount: number;
    storagePath?: string;
    migrateRequired?: boolean;
    legacyPath?: string | null;
};

export type CanvasProjectBundle = CanvasProject & {
    canvases: CanvasDocument[];
    assets: Asset[];
};

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasGenerationIntent = "new" | "repeat" | "retry" | "resume";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasGenerationReferenceSnapshot = {
    nodeId: string;
    kind: "image" | "video" | "audio" | "text";
    storageKey?: string;
    url?: string;
    text?: string;
    mimeType?: string;
};

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
    seed?: number;
    jobId?: string;
    queuePosition?: number;
    networkRetryText?: string;
    progressPct?: number;
    progressNodeClassType?: string;
    progressNodeStep?: number;
    progressNodeSteps?: number;
    isTimeout?: boolean;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    jobId?: string;
    queuePosition?: number;
    networkRetryText?: string;
    progressPct?: number;
    progressNodeClassType?: string;
    progressNodeStep?: number;
    progressNodeSteps?: number;
    isTimeout?: boolean;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    effectivePrompt?: string;
    generationReferences?: CanvasGenerationReferenceSnapshot[];
    generationOriginNodeId?: string;
    jobId?: string;
    queuePosition?: number;
    networkRetryText?: string;
    progressPct?: number;
    progressNodeClassType?: string;
    progressNodeStep?: number;
    progressNodeSteps?: number;
    isTimeout?: boolean;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    channelId?: string;
    workflowId?: string;
    model?: string;
    modelId?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    seed?: number;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    videoMode?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    audioSeconds?: string;
    maxLength?: number;
    thinking?: boolean;
    isSubject?: boolean;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    assetId?: string;
    // 剧本实体与画布节点之间的稳定映射，例如 asset:角色:林昭、shot:第1集:镜3
    scriptKey?: string;
    // 跨画布引用来源，仅从其他画布资产创建引用节点时写入
    sourceAssetId?: string;
    sourceCanvasId?: string;
    storageKey?: string;
    posterUrl?: string;
    posterStorageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    supportedTools?: ModelSupportedTools;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnectionKind = "input" | "lineage";

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    kind: CanvasConnectionKind;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
    mimeType?: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
