import assert from "node:assert/strict";
import test from "node:test";

import { runOpenAiConversation, type OpenAiConversationOptions } from "./openai.js";
import type { AgentEmit } from "./types.js";

type EventRecord = { type: string; payload: Record<string, unknown> };
type RequestRecord = { body: Record<string, unknown> };

const config = { apiKey: "test-key", baseUrl: "https://openai.test/v1", model: "gpt-test" };

function response(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function functionCall(arguments_ = "{}") {
    return {
        id: "resp-tool-1",
        output: [{ type: "function_call", id: "item-tool-1", call_id: "call-1", name: "canvas_get_state", arguments: arguments_ }],
    };
}

function finalMessage(text = "已完成") {
    return {
        id: "resp-message-1",
        output: [{ type: "message", id: "item-message-1", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 8, input_tokens_details: { cached_tokens: 3 }, output_tokens: 2 },
    };
}

function optionsFor(requests: RequestRecord[], events: EventRecord[], responses: Response[], callTool: OpenAiConversationOptions["callTool"]): OpenAiConversationOptions {
    const emit: AgentEmit = (type, payload) => events.push({ type, payload: payload as Record<string, unknown> });
    return {
        config,
        prompt: "读取画布",
        attachments: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        callTool,
        emit,
        threadId: "thread-1",
        turnId: "turn-1",
        sourceClientId: "client-1",
        fetchImpl: async (_input, init) => {
            requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
            const next = responses.shift();
            if (!next) throw new Error("unexpected request");
            return next;
        },
    };
}

test("function_call 经 callTool 后以 function_call_output 和 previous_response_id 继续", async () => {
    const requests: RequestRecord[] = [];
    const events: EventRecord[] = [];
    const calls: Array<{ name: string; args: unknown }> = [];
    const options = optionsFor(requests, events, [response(functionCall()), response(finalMessage())], async (name, args) => {
        calls.push({ name, args });
        return { nodes: [] };
    });

    const result = await runOpenAiConversation(options);

    assert.equal(result.responseId, "resp-message-1");
    assert.deepEqual(calls, [{ name: "canvas_get_state", args: {} }]);
    assert.equal(requests.length, 2);
    const tools = requests[0].body.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0);
    assert.ok(tools.every((tool) => tool.type === "function" && typeof tool.name === "string" && !("function" in tool)));
    assert.equal(requests[0].body.previous_response_id, undefined);
    assert.equal(requests[1].body.previous_response_id, "resp-tool-1");
    assert.deepEqual(requests[1].body.input, [{
        type: "function_call_output",
        call_id: "call-1",
        output: JSON.stringify({ ok: true, result: { nodes: [] } }),
    }]);
    const input = requests[0].body.input as Array<{ content: Array<Record<string, unknown>> }>;
    assert.equal(input[0].content[0].type, "input_text");
    assert.deepEqual(input[0].content[1], { type: "input_image", image_url: "data:image/png;base64,aW1hZ2U=" });
    const message = events.find((event) => event.payload.type === "item.completed" && (event.payload.item as Record<string, unknown>)?.type === "agent_message");
    assert.equal((message?.payload.item as Record<string, unknown>).text, "已完成");
    assert.equal(message?.payload.agent, "openai");
    assert.equal(message?.payload.threadId, "thread-1");
    assert.equal(message?.payload.turnId, "turn-1");
    assert.equal(message?.payload.sourceClientId, "client-1");
    const usage = events.find((event) => event.payload.type === "usage.updated");
    assert.deepEqual(usage?.payload.usage, { input_tokens: 8, cached_input_tokens: 3, output_tokens: 2 });
});

test("工具执行异常会显示失败并结构化回传模型", async () => {
    const requests: RequestRecord[] = [];
    const events: EventRecord[] = [];
    const options = optionsFor(requests, events, [response(functionCall()), response(finalMessage("已处理工具错误"))], async () => {
        throw new Error("工具参数无效");
    });

    await runOpenAiConversation(options);

    const input = requests[1].body.input as Array<Record<string, unknown>>;
    assert.deepEqual(JSON.parse(String(input[0].output)), { ok: false, error: { message: "工具参数无效" } });
    const completed = events.find((event) => event.payload.type === "item.completed" && (event.payload.item as Record<string, unknown>)?.type === "mcp_tool_call");
    assert.equal((completed?.payload.item as Record<string, unknown>).status, "failed");
    assert.deepEqual((completed?.payload.item as Record<string, unknown>).error, { message: "工具参数无效" });
});

test("HTTP 错误提炼服务端 error.message 且不泄露 API Key", async () => {
    const requests: RequestRecord[] = [];
    const events: EventRecord[] = [];
    const options = optionsFor(requests, events, [response({ error: { message: "Invalid key test-key" } }, 401)], async () => ({}));

    await assert.rejects(runOpenAiConversation(options), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /OpenAI 请求失败（401）：Invalid key \[redacted\]/);
        assert.doesNotMatch(error.message, /test-key/);
        return true;
    });
});
