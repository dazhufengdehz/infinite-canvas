import { buildWorkflowModelProfiles, CUSTOM_WORKFLOW_CATEGORIES, validateModelExecution } from "@/services/api/models";
import { getChannelWorkflows, getDefaultWorkflow, type AiConfig, type ComfyWorkflowItem, type ModelChannel, type WorkflowCategory } from "@/stores/use-config-store";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasGenerationMode } from "@/types/canvas";

/** 将 Agent 创建的配置节点绑定到当前真实工作流，并复用生成前的资源与参数校验。 */
export function bindAgentCanvasWorkflows(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot, config: AiConfig) {
    return ops.map((op) => {
        if (op.type !== "add_node" || op.nodeType !== "config" || !op.metadata?.generationMode) return op;
        const mode = op.metadata.generationMode;
        const channel = resolveChannel(config, op.metadata.channelId);
        const references = referenceCounts(ops, snapshot, op.id);
        const categories = workflowCategories(mode, references.imagesCount);
        const requested = op.metadata.workflowId?.trim();
        const workflows = getChannelWorkflows(channel, categories);
        const workflow = requested
            ? workflows.find((item) => matchesWorkflow(item, requested))
            : getDefaultWorkflow(channel, categories);
        if (requested && !workflow) throw new Error(`渠道「${channel.name}」中不存在适用于当前生成模式的工作流：${requested}`);
        if (!workflow) throw new Error(`渠道「${channel.name}」暂无可用工作流，请先上传并配置工作流`);
        const profile = buildWorkflowModelProfiles([workflow])[0];
        if (!profile) throw new Error(`工作流「${workflow.name}」无法解析为可执行配置`);
        validateModelExecution(profile, {
            ...references,
            size: op.metadata.size,
            duration: op.metadata.seconds ? Number(op.metadata.seconds) : undefined,
        });
        return {
            ...op,
            metadata: {
                ...op.metadata,
                channelId: channel.id,
                workflowId: workflow.id,
                modelId: profile.id,
                ...(mode === "video" ? { videoMode: workflow.category === "frameVideo" ? "frame" : "omni" } : {}),
            },
        };
    });
}

function resolveChannel(config: AiConfig, channelId?: string) {
    const channel = (channelId ? config.channels.find((item) => item.id === channelId) : undefined)
        || config.channels.find((item) => item.id === config.channelId)
        || config.channels[0];
    if (!channel) throw new Error("当前没有可用的 ComfyUI 渠道");
    if (channelId && channel.id !== channelId) throw new Error(`当前不存在 ComfyUI 渠道：${channelId}`);
    return channel;
}

function matchesWorkflow(workflow: ComfyWorkflowItem, requested: string) {
    if (workflow.id === requested || workflow.name.toLowerCase() === requested.toLowerCase()) return true;
    return buildWorkflowModelProfiles([workflow])[0]?.id === requested;
}

function workflowCategories(mode: CanvasGenerationMode, imageCount: number): WorkflowCategory[] {
    if (mode === "image" && imageCount > 0) return ["i2i"];
    return CUSTOM_WORKFLOW_CATEGORIES[mode];
}

function referenceCounts(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot, configNodeId?: string) {
    const references = ops.flatMap((op) => {
        if (op.type !== "connect_nodes" || op.toNodeId !== configNodeId) return [];
        const node = snapshot.nodes.find((item) => item.id === op.fromNodeId);
        return node ? [node.type] : [];
    });
    return {
        imagesCount: references.filter((type) => type === "image").length,
        videosCount: references.filter((type) => type === "video").length,
        audiosCount: references.filter((type) => type === "audio").length,
    };
}
