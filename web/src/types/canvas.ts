import type { ModelSupportedTools } from "@/services/api/models/types";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { Asset } from "@/stores/use-asset-store";

export type CanvasScriptOptions = {
    episodes?: number;
    duration?: number;
    genre?: string;
    audience?: string;
    orientation?: "vertical" | "horizontal";
    keep?: string;
    change?: string;
};

export type ScriptAssetKind = "character" | "scene" | "prop" | "video" | "audio";

/** 剧本资产：图片类为 character/scene/prop，参考类为 video/audio。 */
export type ScriptAsset = {
    id: string;
    kind: ScriptAssetKind;
    name: string;
    description: string;
    prompt: string;
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

/** 结构化镜头：参数与有序引用随镜头保存，画布节点由 script-node 派生。 */
export type ScriptShot = {
    id: string;
    number: number;
    title: string;
    duration: number;
    size: string;
    imageAssetIds: string[];
    videoAssetIds: string[];
    audioAssetIds: string[];
    h3: ScriptH3Prompt;
};

export type ScriptStoryboardEpisode = {
    id: string;
    number: number;
    title: string;
    shots: ScriptShot[];
};

/** 项目级剧本数据：原文/设定/大纲/正文为 Markdown，资产与分镜为唯一权威结构化数据。 */
export type CanvasScriptState = {
    version: 2;
    updatedAt: string;
    source: string;
    condensed: string;
    options: CanvasScriptOptions;
    setting: string;
    outline: string;
    script: string;
    assets: ScriptAsset[];
    storyboard: ScriptStoryboardEpisode[];
};

export type CanvasProject = {
    id: string;
    schemaVersion: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    activeCanvasId: string | null;
    script?: CanvasScriptState;
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
