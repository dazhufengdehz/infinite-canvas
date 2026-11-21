import { zodToJsonSchema } from "zod-to-json-schema";

import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "./schemas.js";

type JsonSchema = Record<string, unknown>;

export type OpenAiFunctionTool = {
    type: "function";
    function: {
        name: ToolName;
        description: string;
        strict: boolean;
        parameters: JsonSchema;
    };
};

/** 将同一套 Zod 工具契约导出为 OpenAI Function Calling 定义。 */
export function getOpenAiToolDefinitions(names: readonly ToolName[] = toolNames): OpenAiFunctionTool[] {
    return names.map((name) => {
        const parameters = zodToJsonSchema(toolInputSchemas[name], { $refStrategy: "none" }) as JsonSchema;
        delete parameters.$schema;
        const strict = supportsStrictSchema(parameters);
        return {
            type: "function",
            function: {
                name,
                description: toolDescriptions[name],
                strict,
                parameters: strict ? toStrictSchema(parameters) : parameters,
            },
        };
    });
}

function supportsStrictSchema(schema: JsonSchema): boolean {
    if (schema.additionalProperties === true) return false;
    if (schema.properties && typeof schema.properties === "object") {
        if (Object.values(schema.properties).some((item) => !supportsStrictSchema(item as JsonSchema))) return false;
    }
    if (schema.items && typeof schema.items === "object" && !supportsStrictSchema(schema.items as JsonSchema)) return false;
    for (const key of ["anyOf", "oneOf", "allOf"]) {
        const variants = schema[key];
        if (Array.isArray(variants) && variants.some((item) => !supportsStrictSchema(item as JsonSchema))) return false;
    }
    return true;
}

/** OpenAI strict 模式要求所有字段出现在 required 中，可选字段通过 null 表达。 */
function toStrictSchema(schema: JsonSchema, optional = false): JsonSchema {
    const next: JsonSchema = { ...schema };
    delete next.default;
    for (const key of ["anyOf", "oneOf", "allOf"]) {
        if (Array.isArray(next[key])) next[key] = (next[key] as JsonSchema[]).map((item) => toStrictSchema(item));
    }
    if (next.items && typeof next.items === "object") next.items = toStrictSchema(next.items as JsonSchema);
    if (next.type === "object" && next.properties && typeof next.properties === "object") {
        const required = new Set(Array.isArray(next.required) ? next.required as string[] : []);
        const properties = Object.fromEntries(Object.entries(next.properties as Record<string, JsonSchema>).map(([key, value]) => [key, toStrictSchema(value, !required.has(key))]));
        next.properties = properties;
        next.required = Object.keys(properties);
        next.additionalProperties = false;
    }
    if (optional && !allowsNull(next)) return { anyOf: [next, { type: "null" }] };
    return next;
}

function allowsNull(schema: JsonSchema): boolean {
    if (schema.type === "null" || Array.isArray(schema.type) && schema.type.includes("null")) return true;
    return Array.isArray(schema.anyOf) && schema.anyOf.some((item) => allowsNull(item as JsonSchema));
}
