import crypto from "node:crypto";

import { getOpenAiToolDefinitions } from "../canvas/openai.js";
import { AGENT_PROMPT, getOpenAiConfig, saveConfig, type CanvasAgentConfig, type OpenAiConfig } from "../config.js";
import { errorMessage } from "../utils/value.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

export const OPENAI_THREAD_ID = "openai-session";
const MAX_TOOL_ROUNDS = 16;
const OPENAI_TOOLS = getOpenAiToolDefinitions().map((tool) => ({
    type: tool.type,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: tool.function.strict,
}));

type OpenAiToolCaller = (name: string, args: unknown) => Promise<unknown>;
type OpenAiScope = { agent: "openai"; threadId: string; turnId: string; sourceClientId: string };
type OpenAiResponse = {
    id?: string;
    output?: Array<Record<string, unknown>>;
    usage?: { input_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens?: number };
    error?: { message?: string };
};
type ActiveOpenAiTurn = {
    threadId: string;
    turnId: string;
    sourceClientId: string;
    controller: AbortController;
    finished: boolean;
};

export type OpenAiConversationOptions = {
    config: Required<OpenAiConfig>;
    prompt: string;
    attachments?: AgentAttachment[];
    callTool: OpenAiToolCaller;
    emit: AgentEmit;
    threadId?: string;
    turnId?: string;
    sourceClientId?: string;
    previousResponseId?: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    maxRounds?: number;
};

let activeTurn: ActiveOpenAiTurn | null = null;
let lastResponseId = "";

export class OpenAiTurnError extends Error {
    constructor(message: string, readonly statusCode = 500) {
        super(message);
        this.name = "OpenAiTurnError";
    }
}

/** 返回不会泄露 API Key 的 OpenAI 配置与运行状态。 */
export function getOpenAiStatus(config: CanvasAgentConfig) {
    const current = getOpenAiConfig(config);
    return {
        ok: true,
        hasApiKey: Boolean(current.apiKey),
        baseUrl: current.baseUrl,
        model: current.model,
        busy: Boolean(activeTurn),
        threadId: activeTurn?.threadId || OPENAI_THREAD_ID,
        turnId: activeTurn?.turnId || "",
    };
}

/** 更新本机 OpenAI 配置并清除旧模型上下文。 */
export function updateOpenAiConfig(config: CanvasAgentConfig, patch: OpenAiConfig) {
    const next = { ...(config.openai || {}) };
    if (patch.apiKey !== undefined) next.apiKey = patch.apiKey.trim() || undefined;
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim() || undefined;
    if (patch.model !== undefined) next.model = patch.model.trim() || undefined;
    config.openai = next;
    saveConfig(config);
    lastResponseId = "";
}

/** 启动唯一活动的 OpenAI Agent turn，后台执行并在结束时清理资源。 */
export function startOpenAiTurn(input: {
    prompt: string;
    sourceClientId: string;
    attachments?: AgentAttachment[];
    config: CanvasAgentConfig;
    callTool: OpenAiToolCaller;
    onFinish?: () => void;
}, emit: AgentEmit) {
    if (activeTurn) throw new OpenAiTurnError("OpenAI 正在运行，请等待当前任务结束或先停止任务", 409);
    const resolved = getOpenAiConfig(input.config);
    if (!resolved.apiKey) throw new OpenAiTurnError("请先在 Agent 设置中配置 OpenAI API Key", 400);
    const turn: ActiveOpenAiTurn = {
        threadId: OPENAI_THREAD_ID,
        turnId: `openai-turn-${crypto.randomUUID()}`,
        sourceClientId: input.sourceClientId,
        controller: new AbortController(),
        finished: false,
    };
    activeTurn = turn;
    const scope = turnScope(turn);
    emit("agent_event", { ...scope, type: "turn.started" });
    void runOpenAiConversation({
        config: resolved,
        prompt: input.prompt,
        attachments: input.attachments,
        callTool: input.callTool,
        emit,
        threadId: turn.threadId,
        turnId: turn.turnId,
        sourceClientId: turn.sourceClientId,
        previousResponseId: lastResponseId,
        signal: turn.controller.signal,
    }).then((result) => {
        if (result.responseId) lastResponseId = result.responseId;
        finishOpenAiTurn(turn, emit, undefined, input.onFinish);
    }, (error) => {
        const safeError = new Error(redactSecret(errorMessage(error), resolved.apiKey));
        finishOpenAiTurn(turn, emit, safeError, input.onFinish);
    });
    return { threadId: turn.threadId, turnId: turn.turnId };
}

/** 中止当前 OpenAI 请求。 */
export function interruptOpenAiTurn(threadId: string) {
    const turn = activeTurn;
    if (!turn || turn.finished || threadId !== turn.threadId) return false;
    turn.controller.abort();
    return true;
}

/** 执行可独立测试的 Responses API 非流式工具调用循环。 */
export async function runOpenAiConversation(options: OpenAiConversationOptions): Promise<{ responseId: string; cancelled: boolean }> {
    const scope: OpenAiScope = {
        agent: "openai",
        threadId: options.threadId || OPENAI_THREAD_ID,
        turnId: options.turnId || `openai-turn-${crypto.randomUUID()}`,
        sourceClientId: options.sourceClientId || "",
    };
    const fetchImpl = options.fetchImpl || fetch;
    const maxRounds = options.maxRounds || MAX_TOOL_ROUNDS;
    let previousResponseId = options.previousResponseId || "";
    let input: unknown = [{
        role: "user",
        content: [
            { type: "input_text", text: options.prompt },
            ...(options.attachments || []).flatMap((item) => item.dataUrl?.startsWith("data:image/") ? [{ type: "input_image", image_url: item.dataUrl }] : []),
        ],
    }];

    for (let round = 0; round < maxRounds; round++) {
        const response = await requestOpenAiResponse(options.config, input, previousResponseId, options.signal, fetchImpl);
        previousResponseId = String(response.id || previousResponseId);
        emitUsage(response, scope, options.emit);
        const output = Array.isArray(response.output) ? response.output : [];
        output.forEach((item, index) => emitMessage(item, response.id || previousResponseId, index, scope, options.emit));
        const calls = output.filter((item) => item.type === "function_call");
        if (!calls.length) return { responseId: previousResponseId, cancelled: false };
        if (round === maxRounds - 1) throw new Error(`OpenAI 工具调用超过最大轮数（${maxRounds}）`);

        const results: Array<Record<string, unknown>> = [];
        for (const call of calls) {
            const callId = String(call.call_id || "");
            if (!callId) throw new Error("OpenAI function_call 缺少 call_id");
            results.push({ type: "function_call_output", call_id: callId, output: await executeOpenAiTool(call, scope, options.callTool, options.emit) });
        }
        input = results;
    }
    throw new Error(`OpenAI 工具调用超过最大轮数（${maxRounds}）`);
}

async function requestOpenAiResponse(config: Required<OpenAiConfig>, input: unknown, previousResponseId: string, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<OpenAiResponse> {
    const response = await fetchImpl(`${config.baseUrl}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            model: config.model,
            instructions: AGENT_PROMPT,
            input,
            tools: OPENAI_TOOLS,
            ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        }),
        signal,
    });
    const text = await response.text();
    let body: OpenAiResponse = {};
    try {
        body = text ? JSON.parse(text) as OpenAiResponse : {};
    } catch {
        if (response.ok) throw new Error("OpenAI 返回了无效的 JSON 响应");
    }
    if (!response.ok) throw new Error(redactSecret(`OpenAI 请求失败（${response.status}）：${body.error?.message || response.statusText || "未知错误"}`, config.apiKey));
    if (body.error?.message) throw new Error(redactSecret(body.error.message, config.apiKey));
    return body;
}

async function executeOpenAiTool(call: Record<string, unknown>, scope: OpenAiScope, callTool: OpenAiToolCaller, emit: AgentEmit) {
    const name = String(call.name || "");
    const rawArguments = String(call.arguments || "{}");
    let args: unknown;
    let parseError: unknown;
    try {
        args = JSON.parse(rawArguments);
    } catch (error) {
        parseError = error;
    }
    const item = {
        id: String(call.id || call.call_id || crypto.randomUUID()),
        type: "mcp_tool_call",
        server: "infinite-canvas",
        tool: name,
        arguments: parseError ? rawArguments : args,
    };
    emit("agent_event", { ...scope, type: "item.started", item: { ...item, status: "inProgress" } });
    try {
        if (parseError) throw parseError;
        const result = await callTool(name, args);
        emit("agent_event", { ...scope, type: "item.completed", item: { ...item, status: "completed", result } });
        return JSON.stringify({ ok: true, result: result ?? null });
    } catch (error) {
        const message = errorMessage(error);
        emit("agent_event", { ...scope, type: "item.completed", item: { ...item, status: "failed", error: { message } } });
        return JSON.stringify({ ok: false, error: { message } });
    }
}

function emitMessage(item: Record<string, unknown>, responseId: string, index: number, scope: OpenAiScope, emit: AgentEmit) {
    if (item.type !== "message") return;
    const content = Array.isArray(item.content) ? item.content : [];
    const text = content.flatMap((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text" ? [String((part as Record<string, unknown>).text || "")] : []).filter(Boolean).join("\n");
    if (!text) return;
    emit("agent_event", {
        ...scope,
        type: "item.completed",
        item: { id: String(item.id || `${responseId}-message-${index}`), type: "agent_message", text },
    });
}

function emitUsage(response: OpenAiResponse, scope: OpenAiScope, emit: AgentEmit) {
    if (!response.usage) return;
    emit("agent_event", {
        ...scope,
        type: "usage.updated",
        usage: {
            input_tokens: Number(response.usage.input_tokens || 0),
            cached_input_tokens: Number(response.usage.input_tokens_details?.cached_tokens || 0),
            output_tokens: Number(response.usage.output_tokens || 0),
        },
    });
}

function finishOpenAiTurn(turn: ActiveOpenAiTurn, emit: AgentEmit, error: Error | undefined, onFinish?: () => void) {
    if (turn.finished) return;
    turn.finished = true;
    const cancelled = turn.controller.signal.aborted;
    const scope = turnScope(turn);
    try {
        if (error && !cancelled) emit("agent_error", { ...scope, message: error.message });
        emit("agent_event", { ...scope, type: "turn.completed", status: cancelled ? "cancelled" : error ? "failed" : "completed", ...(error && !cancelled ? { error: { message: error.message } } : {}) });
        emit("agent_done", { ...scope, code: error && !cancelled ? 1 : 0 });
    } finally {
        if (activeTurn === turn) activeTurn = null;
        onFinish?.();
    }
}

function turnScope(turn: ActiveOpenAiTurn): OpenAiScope {
    return { agent: "openai", threadId: turn.threadId, turnId: turn.turnId, sourceClientId: turn.sourceClientId };
}

function redactSecret(message: string, secret: string) {
    return secret ? message.split(secret).join("[redacted]") : message;
}
