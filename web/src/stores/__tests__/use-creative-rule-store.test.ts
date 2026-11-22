import { describe, expect, it } from "vitest";

import { buildCreativeRulePrompt, createCreativeRule, type CreativeRule } from "@/stores/use-creative-rule-store";

const rule = (patch: Partial<CreativeRule>): CreativeRule => createCreativeRule({ name: "规则", content: "内容", ...patch });

describe("创作规则注入", () => {
    it("只注入已启用且有内容的规则", () => {
        const prompt = buildCreativeRulePrompt([
            rule({ name: "画风", content: "低饱和青橙色调", enabled: true }),
            rule({ name: "停用", content: "不该出现", enabled: false }),
            rule({ name: "空白", content: "   ", enabled: true }),
        ]);
        expect(prompt).toContain("低饱和青橙色调");
        expect(prompt).not.toContain("不该出现");
        expect(prompt).not.toContain("空白");
    });

    it("规则名非空时作为标题拼进注入文本", () => {
        const prompt = buildCreativeRulePrompt([rule({ name: "电影感写实", content: "写实质感" })]);
        expect(prompt).toBe("【电影感写实】\n写实质感");
    });

    it("规则名为空时只注入正文", () => {
        const prompt = buildCreativeRulePrompt([rule({ name: "  ", content: "写实质感" })]);
        expect(prompt).toBe("写实质感");
    });

    it("多条启用规则按顺序拼接并空行分隔", () => {
        const prompt = buildCreativeRulePrompt([
            rule({ name: "A", content: "第一条" }),
            rule({ name: "B", content: "第二条" }),
        ]);
        expect(prompt).toBe("【A】\n第一条\n\n【B】\n第二条");
    });

    it("没有可用规则时返回空字符串，不注入任何内容", () => {
        expect(buildCreativeRulePrompt([])).toBe("");
        expect(buildCreativeRulePrompt([rule({ enabled: false })])).toBe("");
    });
});
