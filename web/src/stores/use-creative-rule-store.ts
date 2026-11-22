import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";

/**
 * 创作规则卡（Skill 式）：一段自由文本，作为 Agent 的项目级创作规则注入所有生产阶段。
 * 内容由用户自定义，可以写画风、人物基调、导演风格等。
 */
export type CreativeRule = {
    id: string;
    /** 规则名，用于快速识别与选择。 */
    name: string;
    /** 规则正文，自由文本，会原样注入 Agent 的 system prompt。 */
    content: string;
    /** 是否启用；未启用的规则不会注入。 */
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
};

export const CREATIVE_RULE_STORE_KEY = "infinite-canvas:creative_rule_store_v1";

/** 内置规则卡：给用户起步的模板，可编辑可删除。 */
export const DEFAULT_CREATIVE_RULES: CreativeRule[] = [
    {
        id: "builtin-cinematic",
        name: "电影感写实",
        content: [
            "视觉风格：写实电影质感，低饱和青橙色调，柔和自然光，避免高对比霓虹；",
            "人物：写实比例与肤质，五官比例自然，避免网红脸与过度磨皮；",
            "导演风格：以 35mm 为主，中近景为主，缓慢横移与轻微手持感，避免快速变焦与炫技运镜。",
        ].join("\n"),
        enabled: false,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: "builtin-cyberpunk",
        name: "赛博朋克",
        content: [
            "视觉风格：赛博朋克夜景，湿滑地面反光，霓虹作为主要光源，高对比冷暖对撞；",
            "人物：未来感服装与配件，金属与合成材质细节，眼神锐利；",
            "导演风格：低角度仰拍为主，快速横移与穿插剪辑，夜景与雨景交替。",
        ].join("\n"),
        enabled: false,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: "builtin-sweet",
        name: "甜宠日常",
        content: [
            "视觉风格：清新明亮，日系暖调柔光，低饱和马卡龙配色，画面干净通透；",
            "人物：干净自然的日常妆容与休闲服装，表情生动、互动自然；",
            "导演风格：平视视角，中景与近景为主，缓慢推拉，节奏轻快不压抑。",
        ].join("\n"),
        enabled: false,
        createdAt: 0,
        updatedAt: 0,
    },
];

export function createCreativeRule(patch?: Partial<CreativeRule>): CreativeRule {
    const now = Date.now();
    return {
        id: patch?.id || `rule-${nanoid(8)}`,
        name: patch?.name ?? "",
        content: patch?.content ?? "",
        enabled: patch?.enabled ?? true,
        createdAt: patch?.createdAt ?? now,
        updatedAt: now,
    };
}

type CreativeRuleStore = {
    rules: CreativeRule[];
    addRule: () => CreativeRule;
    saveRule: (rule: CreativeRule) => void;
    removeRule: (id: string) => void;
    toggleRule: (id: string, enabled: boolean) => void;
};

export const useCreativeRuleStore = create<CreativeRuleStore>()(
    persist(
        (set) => ({
            rules: DEFAULT_CREATIVE_RULES,
            addRule: () => {
                const rule = createCreativeRule();
                set((state) => ({ rules: [...state.rules, rule] }));
                return rule;
            },
            saveRule: (rule) =>
                set((state) => ({
                    rules: state.rules.map((item) => (item.id === rule.id ? { ...rule, updatedAt: Date.now() } : item)),
                })),
            removeRule: (id) => set((state) => ({ rules: state.rules.filter((item) => item.id !== id) })),
            toggleRule: (id, enabled) => set((state) => ({ rules: state.rules.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
        }),
        {
            name: CREATIVE_RULE_STORE_KEY,
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ rules: state.rules }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<CreativeRuleStore>;
                const savedRules = Array.isArray(persistedState.rules) ? persistedState.rules : [];
                const enabledById = new Map(savedRules.map((rule) => [rule.id, rule.enabled]));
                const builtIn = DEFAULT_CREATIVE_RULES.map((rule) => ({ ...rule, enabled: enabledById.get(rule.id) ?? rule.enabled }));
                const custom = savedRules.filter((rule) => !rule.id.startsWith("builtin-")).map((rule) => createCreativeRule(rule));
                return { ...current, rules: [...builtIn, ...custom] };
            },
        },
    ),
);

/**
 * 组装注入 Agent 的创作规则文本。
 * 只取已启用的规则，按创建顺序拼接。
 */
export function buildCreativeRulePrompt(rules: CreativeRule[]) {
    return rules
        .filter((rule) => rule.enabled && rule.content.trim())
        .map((rule) => (rule.name.trim() ? `【${rule.name.trim()}】\n${rule.content.trim()}` : rule.content.trim()))
        .join("\n\n");
}
