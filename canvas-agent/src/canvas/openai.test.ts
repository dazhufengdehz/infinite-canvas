import assert from "node:assert/strict";
import { test } from "node:test";

import { getOpenAiToolDefinitions } from "./openai.js";
import { parseToolInput } from "./tools.js";

type Schema = {
    type?: string;
    properties?: Record<string, Schema>;
    required?: string[];
    additionalProperties?: boolean;
    anyOf?: Schema[];
};

test("closed generation tools export strict OpenAI function schemas", () => {
    const tool = getOpenAiToolDefinitions(["canvas_generate_audio"])[0];
    const parameters = tool.function.parameters as Schema;
    assert.equal(tool.type, "function");
    assert.equal(tool.function.strict, true);
    assert.equal(parameters.additionalProperties, false);
    assert.deepEqual(parameters.required, Object.keys(parameters.properties || {}));
    assert.ok(parameters.properties?.workflowId?.anyOf?.some((item) => item.type === "null"));
    assert.ok(parameters.properties?.channelId?.anyOf?.some((item) => item.type === "null"));
});

test("open record tools remain OpenAI compatible without strict mode", () => {
    const tool = getOpenAiToolDefinitions(["canvas_apply_ops"])[0];
    assert.equal(tool.function.strict, false);
    assert.equal(tool.function.name, "canvas_apply_ops");
});

test("strict null optionals are normalized before Zod parsing", () => {
    const input = parseToolInput("canvas_generate_audio", {
        prompt: "一段舒缓音乐",
        title: null,
        x: null,
        y: null,
        referenceNodeIds: null,
        channelId: null,
        workflowId: null,
    });
    assert.deepEqual(input, { prompt: "一段舒缓音乐" });
});
