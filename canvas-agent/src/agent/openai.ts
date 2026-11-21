import crypto from "node:crypto";

import { getOpenAiToolDefinitions } from "../canvas/openai.js";
import { AGENT_PROMPT, getOpenAiConfig, saveConfig, type CanvasAgentConfig, type OpenAiConfig, type OpenAiProtocol } from "../config.js";
import { errorMessage } from "../utils/value.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

export const OPENAI_THREAD_ID = "openai-session";
const MAX_TOOL_ROUNDS = 16;
const MAX_CHAT_HISTORY = 40;
const TOOL_DEFINITIONS = getOpenAiToolDefinitions();
const RESPONSES_TOOLS = TOOL_DEFINITIONS.map((tool) => ({
    type: tool.type,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: tool.function.strict,
}));
const CHAT_TOOLS = TOOL_DEFINITIONS.map((tool) => ({
    type: "function" as const,
    function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    },
}));

type OpenAiToolCaller = (name: string, args: unknown) => Promise<unknown>;
type OpenAiScope = { agent: "openai"; threadId: string; turnId: string; sourceClientId: string };
type OpenAiResponse = {
    id?: string;
    output?: Array<Record<string, unknown>>;
    usage?: { input_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens?: number };
    error?: { message?: string };
};
type ChatToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: string } };
type ChatMessage = Record<string, unknown> & { role: string };
type ChatCompletionResponse = {
    id?: string;
    choices?: Array<{ message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> | null; tool_calls?: ChatToolCall[] } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    error?: { message?: string };
};
type ActiveOpenAiTurn = {
    threadId: string;
    turnId: string;
    sourceClientId: string;
    controller: AbortController;
    finished: boolean;
};
export type OpenAiTurnProtocol = Exclude<OpenAiProtocol, "auto">;

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
    protocol?: OpenAiProtocol;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    maxRounds?: number;
};

let activeTurn: ActiveOpenAiTurn | null = null;
let lastResponseId = "";
let lastChatMessages: ChatMessage[] = [];
let detectedProtocol: { baseUrl: string; protocol: OpenAiTurnProtocol } | null = null;

export class OpenAiTurnError extends Error {
    constructor(message: string, readonly statusCode = 500) {
        super(message);
        this.name = "OpenAiTurnError";
    }
}

class OpenAiHttpError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "OpenAiHttpError";
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
        protocol: current.protocol,
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
    if (patch.protocol !== undefined) next.protocol = patch.protocol;
    config.openai = next;
    saveConfig(config);
    resetOpenAiContext();
}

/** 拉取当前 Base URL 下可用的模型 ID，供设置页快速选择。 */
export async function listOpenAiModels(config: CanvasAgentConfig, fetchImpl: typeof fetch = fetch) {
    const current = getOpenAiConfig(config);
    if (!current.apiKey) throw new OpenAiTurnError("请先在 Agent 设置中配置 OpenAI API Key", 400);
    let response: Response;
    try {
        response = await fetchWithHint(fetchImpl, apiUrl(current.baseUrl, "/models"), {
            headers: { Authorization: `Bearer ${current.apiKey}`, Accept: "application/json" },
            signal: AbortSignal.timeout(15000),
        }, current.apiKey);
    } catch (error) {
        throw new OpenAiTurnError(errorMessage(error), 502);
    }
    const text = await response.text();
    let body: { data?: Array<{ id?: string }>; error?: { message?: string } } = {};
    try {
        body = text ? JSON.parse(text) as typeof body : {};
    } catch {
        if (response.ok) throw new OpenAiTurnError("模型列表返回了无效的 JSON 响应", 502);
    }
    if (!response.ok) throw new OpenAiTurnError(redactSecret(`获取模型列表失败（${response.status}）：${body.error?.message || response.statusText || "未知错误"}`, current.apiKey), 502);
    return [...new Set((body.data || []).map((item) => String(item.id || "")).filter(Boolean))].sort();
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
    const protocol = resolveTurnProtocol(resolved);
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
        protocol,
        signal: turn.controller.signal,
    }).then((result) => {
        if (result.responseId) lastResponseId = result.responseId;
        if (resolved.protocol === "auto") detectedProtocol = { baseUrl: resolved.baseUrl, protocol: result.protocol };
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

/** 执行可独立测试的 OpenAI 工具调用循环，auto 模式下自动在两种协议间降级。 */
export async function runOpenAiConversation(options: OpenAiConversationOptions): Promise<{ responseId: string; cancelled: boolean; protocol: OpenAiTurnProtocol }> {
    const requested = options.protocol && options.protocol !== "auto" ? options.protocol : "";
    if (requested === "chat") return { ...(await runChatConversation(options)), protocol: "chat" };
    if (requested === "responses") return { ...(await runResponsesConversation(options)), protocol: "responses" };
    try {
        return { ...(await runResponsesConversation(options)), protocol: "responses" };
    } catch (error) {
        if (!isProtocolMismatch(error)) throw error;
        options.emit("agent_log", { text: `当前接口不支持 Responses API，已自动切换为 Chat Completions：${errorMessage(error)}` });
        return { ...(await runChatConversation(options)), protocol: "chat" };
    }
}

/** Responses API 工具循环。 */
async function runResponsesConversation(options: OpenAiConversationOptions): Promise<{ responseId: string; cancelled: boolean }> {
    const scope = conversationScope(options);
    const fetchImpl = options.fetchImpl || fetch;
    const maxRounds = options.maxRounds || MAX_TOOL_ROUNDS;
    let previousResponseId = options.previousResponseId || "";
    let useTools = true;
    let toolsDegraded = false;
    let input: unknown = [{
        role: "user",
        content: [
            { type: "input_text", text: options.prompt },
            ...(options.attachments || []).flatMap((item) => item.dataUrl?.startsWith("data:image/") ? [{ type: "input_image", image_url: item.dataUrl }] : []),
        ],
    }];

    for (let round = 0; round < maxRounds; round++) {
        let response: OpenAiResponse;
        try {
            response = await requestOpenAiResponse(options.config, input, previousResponseId, useTools, options.signal, fetchImpl);
        } catch (error) {
            if (useTools && isToolUnsupported(error)) {
                useTools = false;
                if (!toolsDegraded) {
                    toolsDegraded = true;
                    options.emit("agent_log", { text: "当前模型不支持工具调用，本轮已自动降级为纯对话（无法操作画布）" });
                }
                round--;
                continue;
            }
            throw error;
        }
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

/** Chat Completions 工具循环，供仅兼容 /chat/completions 的聚合平台使用。 */
async function runChatConversation(options: OpenAiConversationOptions): Promise<{ responseId: string; cancelled: boolean }> {
    const scope = conversationScope(options);
    const fetchImpl = options.fetchImpl || fetch;
    const maxRounds = options.maxRounds || MAX_TOOL_ROUNDS;
    const messages: ChatMessage[] = [
        ...(lastChatMessages.length ? lastChatMessages : [{ role: "system", content: AGENT_PROMPT }]),
        buildChatUserMessage(options.prompt, options.attachments),
    ];
    let useTools = true;
    let toolsDegraded = false;

    for (let round = 0; round < maxRounds; round++) {
        let response: ChatCompletionResponse;
        try {
            response = await requestChatCompletion(options.config, messages, useTools, options.signal, fetchImpl);
        } catch (error) {
            if (useTools && isToolUnsupported(error)) {
                useTools = false;
                if (!toolsDegraded) {
                    toolsDegraded = true;
                    options.emit("agent_log", { text: "当前模型不支持工具调用，本轮已自动降级为纯对话（无法操作画布）" });
                }
                round--;
                continue;
            }
            throw error;
        }
        const responseId = String(response.id || "");
        emitChatUsage(response, scope, options.emit);
        const message = response.choices?.[0]?.message;
        const text = chatContentText(message?.content);
        if (text) {
            options.emit("agent_event", {
                ...scope,
                type: "item.completed",
                item: { id: `${responseId || "chat"}-message-${round}`, type: "agent_message", text },
            });
        }
        const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
        if (!calls.length) {
            lastChatMessages = trimChatHistory(messages);
            return { responseId, cancelled: false };
        }
        if (round === maxRounds - 1) throw new Error(`OpenAI 工具调用超过最大轮数（${maxRounds}）`);

        messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: calls });
        for (const call of calls) {
            const callId = String(call.id || "");
            if (!callId) throw new Error("OpenAI tool_call 缺少 id");
            const output = await executeOpenAiTool({
                id: callId,
                call_id: callId,
                name: call.function?.name,
                arguments: call.function?.arguments || "{}",
            }, scope, options.callTool, options.emit);
            messages.push({ role: "tool", tool_call_id: callId, content: output });
        }
    }
    throw new Error(`OpenAI 工具调用超过最大轮数（${maxRounds}）`);
}

async function requestOpenAiResponse(config: Required<OpenAiConfig>, input: unknown, previousResponseId: string, useTools: boolean, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<OpenAiResponse> {
    const url = apiUrl(config.baseUrl, "/responses");
    const response = await fetchWithHint(fetchImpl, url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            model: config.model,
            instructions: AGENT_PROMPT,
            input,
            ...(useTools ? { tools: RESPONSES_TOOLS } : {}),
            ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        }),
        signal,
    }, config.apiKey);
    const text = await response.text();
    let body: OpenAiResponse = {};
    try {
        body = text ? JSON.parse(text) as OpenAiResponse : {};
    } catch {
        if (response.ok) throw new Error("OpenAI 返回了无效的 JSON 响应");
    }
    if (!response.ok) throw new OpenAiHttpError(redactSecret(`OpenAI 请求失败（${response.status}）：${body.error?.message || response.statusText || "未知错误"}`, config.apiKey), response.status);
    if (body.error?.message) throw new OpenAiHttpError(redactSecret(body.error.message, config.apiKey), 0);
    return body;
}

async function requestChatCompletion(config: Required<OpenAiConfig>, messages: ChatMessage[], useTools: boolean, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<ChatCompletionResponse> {
    const url = apiUrl(config.baseUrl, "/chat/completions");
    const response = await fetchWithHint(fetchImpl, url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            model: config.model,
            messages,
            ...(useTools ? { tools: CHAT_TOOLS, tool_choice: "auto" } : {}),
        }),
        signal,
    }, config.apiKey);
    const text = await response.text();
    let body: ChatCompletionResponse = {};
    try {
        body = text ? JSON.parse(text) as ChatCompletionResponse : {};
    } catch {
        if (response.ok) throw new Error("OpenAI 返回了无效的 JSON 响应");
    }
    if (!response.ok) throw new OpenAiHttpError(redactSecret(`OpenAI 请求失败（${response.status}）：${body.error?.message || response.statusText || "未知错误"}`, config.apiKey), response.status);
    if (body.error?.message) throw new OpenAiHttpError(redactSecret(body.error.message, config.apiKey), 0);
    return body;
}

/** 把底层 fetch 的网络错误转换为可操作提示。 */
async function fetchWithHint(fetchImpl: typeof fetch, url: string, init: RequestInit, apiKey: string) {
    try {
        return await fetchImpl(url, init);
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        const detail = cause?.code || cause?.message || errorMessage(error);
        throw new Error(redactSecret(`无法连接 ${url}（${detail}）。请检查 Base URL 是否正确，或该地址是否需要代理。`, apiKey));
    }
}

/** 兼容带或不带 /v1 后缀的 Base URL。 */
export function apiUrl(baseUrl: string, path: string) {
    const base = baseUrl.replace(/\/+$/, "");
    return `${/\/v\d+$/.test(base) ? base : `${base}/v1`}${path}`;
}

function buildChatUserMessage(prompt: string, attachments?: AgentAttachment[]): ChatMessage {
    const images = (attachments || []).filter((item) => item.dataUrl?.startsWith("data:image/"));
    if (!images.length) return { role: "user", content: prompt };
    return {
        role: "user",
        content: [
            { type: "text", text: prompt },
            ...images.map((item) => ({ type: "image_url", image_url: { url: item.dataUrl } })),
        ],
    };
}

function chatContentText(content: string | Array<{ type?: string; text?: string }> | null | undefined) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((part) => part?.type === "text" && part.text).map((part) => String(part.text)).join("\n");
}

function trimChatHistory(messages: ChatMessage[]) {
    if (messages.length <= MAX_CHAT_HISTORY) return messages;
    return [messages[0], ...messages.slice(-(MAX_CHAT_HISTORY - 1))];
}

function isProtocolMismatch(error: unknown) {
    if (!(error instanceof OpenAiHttpError)) return false;
    if (error.status === 404 || error.status === 405) return true;
    return error.status === 400 && /responses|unknown\s+(url|endpoint|route)|not\s+found|unsupported/i.test(error.message);
}

function isToolUnsupported(error: unknown) {
    if (!(error instanceof OpenAiHttpError)) return false;
    if (![400, 404, 422].includes(error.status)) return false;
    return /tool|function/i.test(error.message);
}

function resolveTurnProtocol(config: Required<OpenAiConfig>): OpenAiProtocol {
    if (config.protocol !== "auto") return config.protocol;
    return detectedProtocol?.baseUrl === config.baseUrl ? detectedProtocol.protocol : "auto";
}

function resetOpenAiContext() {
    lastResponseId = "";
    lastChatMessages = [];
    detectedProtocol = null;
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

function emitChatUsage(response: ChatCompletionResponse, scope: OpenAiScope, emit: AgentEmit) {
    if (!response.usage) return;
    emit("agent_event", {
        ...scope,
        type: "usage.updated",
        usage: {
            input_tokens: Number(response.usage.prompt_tokens || 0),
            cached_input_tokens: Number(response.usage.prompt_tokens_details?.cached_tokens || 0),
            output_tokens: Number(response.usage.completion_tokens || 0),
        },
    });
}

function conversationScope(options: OpenAiConversationOptions): OpenAiScope {
    return {
        agent: "openai",
        threadId: options.threadId || OPENAI_THREAD_ID,
        turnId: options.turnId || `openai-turn-${crypto.randomUUID()}`,
        sourceClientId: options.sourceClientId || "",
    };
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
