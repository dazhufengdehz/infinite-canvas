// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});

import { buildWorkflowModelProfiles } from "@/services/api/models";
import { defaultConfig, getDefaultWorkflow, type AiConfig } from "@/stores/use-config-store";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { bindAgentCanvasWorkflows } from "./agent-canvas-workflows";

const emptySnapshot: CanvasAgentSnapshot = {
    projectId: "project-1",
    canvasId: "canvas-1",
    title: "测试画布",
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

function configOp(metadata: Record<string, unknown>): CanvasAgentOp {
    return { type: "add_node", id: "config-agent", nodeType: "config", metadata };
}

describe("bindAgentCanvasWorkflows", () => {
    it("为默认图片和音频生成写入真实工作流三元绑定", () => {
        for (const mode of ["image", "audio"] as const) {
            const [bound] = bindAgentCanvasWorkflows([configOp({ generationMode: mode })], emptySnapshot, defaultConfig);
            const workflow = getDefaultWorkflow(defaultConfig.channels[0], mode === "image" ? "t2i" : "audio");
            expect(bound).toMatchObject({
                type: "add_node",
                metadata: { channelId: "builtin", workflowId: workflow?.id },
            });
            expect(bound.type === "add_node" && bound.metadata?.modelId).toBe(buildWorkflowModelProfiles([workflow!])[0]?.id);
        }
    });

    it("支持通过工作流名称或 Profile ID 显式选择", () => {
        const workflow = defaultConfig.channels[0].workflows?.find((item) => item.category === "t2i" && !item.isDefault)
            || defaultConfig.channels[0].workflows?.find((item) => item.category === "t2i");
        const profile = buildWorkflowModelProfiles([workflow!])[0];
        for (const workflowId of [workflow!.name, profile.id]) {
            const [bound] = bindAgentCanvasWorkflows([configOp({ generationMode: "image", workflowId })], emptySnapshot, defaultConfig);
            expect(bound).toMatchObject({ type: "add_node", metadata: { workflowId: workflow!.id, modelId: profile.id } });
        }
    });

    it("有参考图时选择图生图工作流", () => {
        const snapshot: CanvasAgentSnapshot = {
            ...emptySnapshot,
            nodes: [{ id: "image-1", type: "image", title: "参考图", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: {} }],
        };
        const ops = [configOp({ generationMode: "image" }), { type: "connect_nodes", fromNodeId: "image-1", toNodeId: "config-agent" } as CanvasAgentOp];
        const [bound] = bindAgentCanvasWorkflows(ops, snapshot, defaultConfig);
        const workflow = defaultConfig.channels[0].workflows?.find((item) => item.id === (bound.type === "add_node" ? bound.metadata?.workflowId : ""));
        expect(workflow?.category).toBe("i2i");
    });

    it("没有真实工作流或显式工作流不匹配时立即报错", () => {
        const config: AiConfig = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], workflows: [] }] };
        expect(() => bindAgentCanvasWorkflows([configOp({ generationMode: "image" })], emptySnapshot, config)).toThrow("暂无可用工作流");
        expect(() => bindAgentCanvasWorkflows([configOp({ generationMode: "audio", workflowId: "missing" })], emptySnapshot, defaultConfig)).toThrow("不存在适用于当前生成模式的工作流");
    });
});
