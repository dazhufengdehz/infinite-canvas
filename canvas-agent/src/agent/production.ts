import { getOpenAiConfig, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { apiUrl, OpenAiTurnError } from "./openai.js";
import { generateScriptStageWith, type ScriptOptions, type ScriptStage } from "./script.js";

/** 原文长度上限：超过必须先走 condense 提炼。 */
export const SOURCE_LENGTH_LIMIT = 60000;
/** 单阶段最多自检返工轮数。 */
const MAX_REWORK_ROUNDS = 2;
/** 给 Agent 阅读的状态摘要里，各部分最多截取的字数。 */
const SOURCE_EXCERPT_LIMIT = 12000;
const SETTING_EXCERPT_LIMIT = 4000;
const SYNOPSIS_EXCERPT_LIMIT = 600;
const ASSETS_EXCERPT_LIMIT = 6000;
/** 审片时读到的产出上限，超出部分不参与审阅。 */
const REVIEW_EXCERPT_LIMIT = 12000;

export type ProductionEpisodeSummary = {
    number: number;
    title: string;
    synopsis: string;
    script: string;
    shotCount: number;
};

/** 生产态快照：Agent 据此判断项目真实进度。 */
export type ProductionAgentState = {
    source: string;
    condensed: string;
    setting: string;
    outline: string;
    script: string;
    assets: string;
    episodes: ProductionEpisodeSummary[];
    assetCount: number;
    shotCount: number;
    options: ScriptOptions;
};

/** Agent 的下一步决策。 */
export type ProductionPlan = {
    stage: ScriptStage;
    /** 判断依据，展示给用户看。 */
    reasoning: string;
    /** 给执行环节的具体指挥，针对本次项目。 */
    instruction: string;
    /** 本轮针对的集号；不需要时为 0。 */
    episode: number;
    /** 是否需要用户确认才能继续。 */
    needsConfirmation: boolean;
    question: string;
    suggestedOptions: string[];
};

/** Agent 对自己产出的审片结论。 */
export type ProductionReview = {
    passed: boolean;
    severity: "none" | "minor" | "major";
    issues: string[];
};

export type ProductionAgentInput = {
    /** 用户整体目标，如「把这部小说做成 12 集竖屏短剧」。 */
    goal: string;
    /** auto：Agent 自主决定做哪一步；stage：执行指定阶段。 */
    mode: "auto" | "stage";
    /** mode=stage 时请求的阶段。 */
    stage?: ScriptStage;
    state: ProductionAgentState;
    preamble?: string;
    instruction?: string;
    episode?: number;
    episodeTotal?: number;
    episodeOutline?: string;
    shot?: string;
    maxRounds?: number;
};

export type ProductionAgentResult = {
    plan: ProductionPlan;
    content: string;
    review: ProductionReview;
    rounds: number;
    /** 因需要用户确认而中断，未产出内容。 */
    awaitingConfirmation: boolean;
};

const PLAN_SYSTEM_PROMPT = `你是一个有独立判断力的短剧制作 Agent。你会拿到项目的当前状态与用户目标，需要自己决定下一步做什么。

你不是流水线工人，不要机械按固定顺序执行每一步。你要：
1. 先通读当前状态，判断项目的真实进度：哪些阶段真的完成了、哪些产出质量不达标需要返工、有没有前置条件还没满足。
2. 决定下一步最有价值的动作。可以是生成某个阶段，可以是重做某个有问题的产出，也可以是向用户确认一个你无法替他决定的关键问题。
3. 如果当前状态存在明显的结构性问题（例如分集数与目标不符、已有设定与原文矛盾、关键角色缺失、某集正文为空），优先修复它，而不是盲目往下走。

只输出一个 JSON 对象，不要输出 Markdown 代码块标记或多余文字：
{"stage":"setting|outline|script|assets|storyboard|shot|condense","reasoning":"你的判断依据，1-3 句，直接说结论","instruction":"给执行环节的具体指挥，要针对本次项目、具体到要写什么注意什么，不要复述通用规则","episode":0,"needsConfirmation":false,"question":"","suggestedOptions":[]}

规则：
- stage 只能取上述枚举值之一。
- 需要用户确认时 needsConfirmation 为 true，question 写清要问什么，suggestedOptions 给 2-4 个具体可选项。
- episode 只在需要写某一集正文或分镜时填集号，否则填 0。
- instruction 不能为空，它是你对这一步的具体指挥。`;

const REVIEW_SYSTEM_PROMPT = `你是严格的作品审片人，审阅刚生成的短剧制作产出，找出真实存在的问题。

不要吹捧，不要为了凑数编造问题。逐项检查：
1. 与已有设定、大纲、正文是否矛盾（人名、性格、事件先后、道具、时间线）。
2. 是否兑现了本次指令与该阶段的目标。
3. 结构完整性：该有的段落是否齐全，有没有占位符、空字段或截断。
4. 时长与集数是否匹配本项目参数。
5. 资产引用是否只用了给定清单里的资产，有没有编造资产。
6. 有没有明显的技术格式问题（JSON 结构、编号连续性、字段名）。

只输出一个 JSON 对象：
{"passed":true,"severity":"none","issues":[]}

issues 必须具体到能直接当作返工指令，例如「第 2 集梗概与第 1 集结尾冲突：第 1 集结尾她还不知道项目存在，第 2 集开场她已在项目组」。没有问题时 issues 为空数组、passed 为 true、severity 为 "none"。`;

/** 各阶段的形式契约，供审片时核对结构完整性。 */
const STAGE_CONTRACT: Record<ScriptStage, string> = {
    condense: "提炼后的故事素材，保留人物、关系、主线、冲突与标志性台词。",
    setting: "Markdown 故事设定，含一句话故事、题材与受众、核心冲突、人物小传、世界观与主要场景、情绪价值与爽点、视觉风格与色彩、表演与声音基调、短剧化策略。",
    outline: "每集以「### 第X集 集名」开头，含核心事件、开场钩子、节拍（3-5 条）、集尾悬念。",
    script: "以「### 第X集 集名」开头，每场以「#### 第X场 地点 时间 内景/外景」开头，含人物、画面与动作、对白、镜头提示。",
    assets: "JSON：{\"assets\":[{\"kind\":\"character|scene|prop\",\"name\",\"description\",\"prompt\",\"h3\":{...},\"variants\":[...]}]}，每个资产含形态列表，h3 字段按 kind 限定。",
    storyboard: "JSON：{\"episode\":{\"title\",\"shots\":[{\"number\",\"title\",\"duration\",\"size\",\"imageAssets\",\"blocking\",\"consistency\",\"h3\":{...}}]}}，h3 六段齐全，引用编号连续不跳号。",
    shot: "JSON：{\"shot\":{...}}，结构同上，number 与原镜头一致。",
};

/**
 * 自主执行一次生产推进：规划 → 生成 → 自检 → 返工。
 * mode=auto 时由 Agent 决定做哪一步；mode=stage 时执行指定阶段，但仍由 Agent 自检与返工。
 */
export async function runProductionAgent(config: CanvasAgentConfig, input: ProductionAgentInput, fetchImpl: typeof fetch = fetch): Promise<ProductionAgentResult> {
    const current = getOpenAiConfig(config);
    if (!current.apiKey) throw new OpenAiTurnError("请先在 Agent 设置中配置 OpenAI API Key", 400);
    const goal = String(input.goal || "").trim();
    if (!goal) throw new OpenAiTurnError("请先说明这次要制作什么", 400);
    const state = input.state || emptyState();
    const maxRounds = Math.min(MAX_REWORK_ROUNDS, Math.max(1, Math.floor(Number(input.maxRounds) || MAX_REWORK_ROUNDS)));

    // 1. 规划：mode=auto 由 Agent 自主决策；mode=stage 也让 Agent 判断该阶段该怎么写。
    const plan = await planNextStep(current, goal, state, input, fetchImpl);

    // 2. 前置条件检查：缺依赖时停下来问用户，而不是硬跑出坏结果。
    const blockers = checkPreconditions(plan.stage, state, input);
    if (blockers.length) {
        return {
            plan: { ...plan, needsConfirmation: true, question: blockers.join("；"), suggestedOptions: plan.suggestedOptions.length ? plan.suggestedOptions : ["补齐前置内容后继续", "先看看现在的产出"] },
            content: "",
            review: { passed: true, severity: "none", issues: [] },
            rounds: 0,
            awaitingConfirmation: true,
        };
    }
    if (plan.needsConfirmation) {
        return { plan, content: "", review: { passed: true, severity: "none", issues: [] }, rounds: 0, awaitingConfirmation: true };
    }

    // 3. 执行 + 自检 + 返工。
    let content = "";
    let review: ProductionReview = { passed: true, severity: "none", issues: [] };
    let rounds = 0;
    let feedback = combineFeedback(plan.instruction, input.instruction);
    for (let round = 0; round < maxRounds; round++) {
        rounds = round + 1;
        const generateStarted = Date.now();
        content = await executeStage(current, plan, state, input, feedback, fetchImpl);
        const generateCost = Date.now() - generateStarted;
        const reviewStarted = Date.now();
        review = await reviewOutput(current, goal, plan, content, fetchImpl);
        const reviewCost = Date.now() - reviewStarted;
        logger.info("Production agent round done", { stage: plan.stage, round, generateMs: generateCost, reviewMs: reviewCost, passed: review.passed });
        if (review.passed) break;
        feedback = combineFeedback(plan.instruction, input.instruction, review.issues);
    }
    return { plan, content, review, rounds, awaitingConfirmation: false };
}

/** 让 Agent 决定下一步做什么，以及这一步该怎么执行。 */
async function planNextStep(current: ReturnType<typeof getOpenAiConfig>, goal: string, state: ProductionAgentState, input: ProductionAgentInput, fetchImpl: typeof fetch): Promise<ProductionPlan> {
    const requested = input.mode === "stage" && input.stage ? input.stage : "";
    const system = requested
        ? `${PLAN_SYSTEM_PROMPT}\n\n注意：调用方请求执行「${requested}」阶段。你可以在此基础上补充更具体的指挥；如果你认为前置条件缺失或这个请求本身不合理，请把 needsConfirmation 设为 true 并在 question 里说明原因与可选方案，不要擅自改成别的阶段。`
        : PLAN_SYSTEM_PROMPT;
    const user = [
        `用户目标：${goal}`,
        "",
        "当前项目状态：",
        summarizeState(state, input),
        "",
        input.preamble?.trim() ? `创作规则（必须遵守）：\n${input.preamble.trim()}` : "",
        input.instruction?.trim() ? `本次额外要求：${input.instruction.trim()}` : "",
        "",
        "请给出下一步的决策。",
    ].filter((line) => line !== "").join("\n");
    const raw = await requestChatJson(current, system, user, fetchImpl);
    const stage = normalizeStage(String(raw.stage || ""), requested);
    return {
        stage,
        reasoning: String(raw.reasoning || "").trim(),
        instruction: String(raw.instruction || "").trim(),
        episode: Number(raw.episode) || Number(input.episode) || 0,
        needsConfirmation: raw.needsConfirmation === true,
        question: String(raw.question || "").trim(),
        suggestedOptions: Array.isArray(raw.suggestedOptions) ? raw.suggestedOptions.map((item) => String(item)).filter(Boolean).slice(0, 4) : [],
    };
}

/** 按 Agent 的决策执行对应阶段。 */
async function executeStage(current: ReturnType<typeof getOpenAiConfig>, plan: ProductionPlan, state: ProductionAgentState, input: ProductionAgentInput, feedback: string, fetchImpl: typeof fetch) {
    const result = await generateScriptStageWith(current, {
        stage: plan.stage,
        source: state.condensed.trim() || state.source.trim(),
        options: state.options,
        setting: state.setting || undefined,
        outline: state.outline || undefined,
        script: state.script || undefined,
        assets: state.assets || undefined,
        preamble: input.preamble || undefined,
        feedback: feedback || undefined,
        episode: plan.episode || input.episode,
        episodeTotal: input.episodeTotal,
        episodeOutline: input.episodeOutline,
        shot: input.shot,
    }, fetchImpl);
    return result.content;
}

/** 审阅本轮产出，决定是否需要返工。 */
async function reviewOutput(current: ReturnType<typeof getOpenAiConfig>, goal: string, plan: ProductionPlan, content: string, fetchImpl: typeof fetch): Promise<ProductionReview> {
    if (!content.trim()) return { passed: false, severity: "major", issues: ["产出为空，没有任何可解析的内容。"] };
    const system = `${REVIEW_SYSTEM_PROMPT}\n\n本次审阅的是「${plan.stage}」阶段的产出，该阶段应满足：${STAGE_CONTRACT[plan.stage]}`;
    const user = [
        `用户目标：${goal}`,
        `本次执行意图：${plan.instruction || plan.reasoning || "（未说明）"}`,
        "",
        "待审产出：",
        // 审片只需看到产出本身，截断避免单次请求过大导致超时。
        content.slice(0, REVIEW_EXCERPT_LIMIT),
        content.length > REVIEW_EXCERPT_LIMIT ? "\n（产出已截断，只审阅前半部分）" : "",
        "",
        "请给出审片结论。",
    ].join("\n");
    try {
        const raw = await requestChatJson(current, system, user, fetchImpl);
        const issues = Array.isArray(raw.issues) ? raw.issues.map((item) => String(item).trim()).filter(Boolean) : [];
        return {
            passed: raw.passed === true && issues.length === 0,
            severity: (["none", "minor", "major"].includes(String(raw.severity)) ? String(raw.severity) : "minor") as ProductionReview["severity"],
            issues,
        };
    } catch {
        // 审片失败不阻断生产，按通过处理。
        return { passed: true, severity: "none", issues: [] };
    }
}

/** 阶段的前置依赖检查：缺依赖时让 Agent 停下来问用户。 */
function checkPreconditions(stage: ScriptStage, state: ProductionAgentState, input: ProductionAgentInput) {
    const blockers: string[] = [];
    const hasEpisodeScript = state.episodes.some((episode) => episode.script.trim());
    if (stage === "outline" && !state.setting.trim()) blockers.push("还没有故事设定，无法生成分集大纲");
    if (stage === "script" && !state.episodes.length) blockers.push("还没有分集大纲，无法写剧本正文");
    if (stage === "assets" && !hasEpisodeScript) blockers.push("还没有任何一集的剧本正文，无法拆解资产");
    if ((stage === "storyboard" || stage === "shot") && !state.assetCount) blockers.push("还没有资产，无法生成分镜（镜头要引用角色、场景与道具）");
    if (stage === "storyboard" && !hasEpisodeScript) blockers.push("还没有剧本正文，无法拆解分镜");
    if (stage === "shot" && !input.shot?.trim()) blockers.push("没有指定要重写的镜头");
    if (stage !== "condense" && !state.source.trim() && !state.condensed.trim()) blockers.push("还没有原文");
    return blockers;
}

/** 把生产态压缩成 Agent 能读懂的状态描述。 */
export function summarizeState(state: ProductionAgentState, input?: ProductionAgentInput) {
    const source = state.source.trim();
    const condensed = state.condensed.trim();
    const sourceLength = source.length;
    // 原文或素材必须给 Agent 看到内容，否则它无法真正理解故事。
    const sourceExcerpt = condensed ? condensed.slice(0, SOURCE_EXCERPT_LIMIT) : source.slice(0, SOURCE_EXCERPT_LIMIT);
    const sourceNote = sourceLength > SOURCE_LENGTH_LIMIT
        ? `${sourceLength} 字（超过 ${SOURCE_LENGTH_LIMIT} 字上限，必须先提炼）`
        : `${sourceLength} 字${condensed ? "（已提炼为素材）" : ""}`;
    const lines = [
        `原文：${sourceNote}`,
        sourceExcerpt ? `原文/素材内容（截取前 ${sourceExcerpt.length} 字）：\n${sourceExcerpt}` : "原文/素材内容：（空）",
        `故事设定：${state.setting.trim() ? "已有" : "无"}`,
    ];
    if (state.setting.trim()) lines.push(`故事设定内容：\n${state.setting.slice(0, SETTING_EXCERPT_LIMIT)}`);
    lines.push(`分集大纲：${state.episodes.length ? `${state.episodes.length} 集` : "无"}`);
    state.episodes.forEach((episode) => {
        lines.push(`  - 第${episode.number}集 ${episode.title || "未命名"}｜梗概：${episode.synopsis.trim() ? episode.synopsis.slice(0, SYNOPSIS_EXCERPT_LIMIT) : "无"}｜正文：${episode.script.trim() ? "有" : "无"}｜分镜：${episode.shotCount} 个`);
    });
    lines.push(`资产：${state.assetCount} 个`);
    if (state.assets.trim()) lines.push(`资产清单：\n${state.assets.slice(0, ASSETS_EXCERPT_LIMIT)}`);
    lines.push(`分镜总数：${state.shotCount} 个`);
    const options = state.options || {};
    lines.push(`项目参数：${options.episodes || 0} 集 / ${options.duration || 0} 秒每集 / ${options.orientation === "horizontal" ? "横屏" : "竖屏"} / 题材：${options.genre?.trim() || "未指定"} / 受众：${options.audience?.trim() || "未指定"}`);
    if (options.subtitle === false) lines.push("字幕：关闭");
    if (options.bgm === false) lines.push("BGM：关闭");
    if (input?.episode) lines.push(`当前聚焦：第 ${input.episode} 集`);
    return lines.join("\n");
}

/** 合并执行指令与返工问题。 */
function combineFeedback(instruction: string, extra: string | undefined, issues?: string[]) {
    const parts = [instruction, extra, issues?.length ? `请修正以下问题：\n${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}` : ""]
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    return parts.join("\n\n");
}

function normalizeStage(value: string, fallback: string) {
    const stages: ScriptStage[] = ["condense", "setting", "outline", "script", "assets", "storyboard", "shot"];
    const found = stages.find((item) => item === value);
    if (found) return found;
    if (fallback) return fallback as ScriptStage;
    return "setting";
}

function emptyState(): ProductionAgentState {
    return { source: "", condensed: "", setting: "", outline: "", script: "", assets: "", episodes: [], assetCount: 0, shotCount: 0, options: {} };
}

/** 与模型对话并要求返回 JSON 对象；解析失败时给出明确错误。 */
async function requestChatJson(current: ReturnType<typeof getOpenAiConfig>, system: string, user: string, fetchImpl: typeof fetch) {
    let response: Response;
    try {
        response = await fetchImpl(apiUrl(current.baseUrl, "/chat/completions"), {
            method: "POST",
            headers: { Authorization: `Bearer ${current.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ model: current.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4 }),
            signal: AbortSignal.timeout(240000),
        });
    } catch (error) {
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        throw new OpenAiTurnError(`无法连接 ${current.baseUrl}（${cause?.code || cause?.message || (error as Error).message}）。请检查 Base URL、网络或代理。`, 502);
    }
    const text = await response.text();
    let body: { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>; error?: { message?: string } } = {};
    try {
        body = text ? JSON.parse(text) as typeof body : {};
    } catch {
        if (response.ok) throw new OpenAiTurnError("Agent 决策接口返回了无效的 JSON 响应", 502);
    }
    if (!response.ok) throw new OpenAiTurnError(`Agent 决策失败（${response.status}）：${body.error?.message || response.statusText || "未知错误"}`, 502);
    const content = normalizeContent(body.choices?.[0]?.message?.content);
    return parseJsonObject(content);
}

function normalizeContent(content: string | Array<{ type?: string; text?: string }> | undefined) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((part) => part?.text).map((part) => String(part.text)).join("\n");
}

/** 从模型输出里提取 JSON 对象，容忍代码块包裹与前后多余文字。 */
export function parseJsonObject(text: string) {
    const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
        return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
        // 继续尝试从文本里截取对象。
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
            // 落到统一错误。
        }
    }
    throw new OpenAiTurnError("Agent 未能返回可解析的 JSON 决策", 502);
}
