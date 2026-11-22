import { getOpenAiConfig, type CanvasAgentConfig } from "../config.js";
import { errorMessage } from "../utils/value.js";
import { apiUrl, OpenAiTurnError } from "./openai.js";

export type ScriptStage = "setting" | "outline" | "script" | "assets" | "storyboard" | "shot" | "condense";

export type ScriptOptions = {
    episodes?: number;
    duration?: number;
    genre?: string;
    audience?: string;
    orientation?: "vertical" | "horizontal";
    keep?: string;
    change?: string;
    /** 是否在提示词中保留台词文本（字幕）。 */
    subtitle?: boolean;
    /** 是否要求非叙事配乐段（BGM）。 */
    bgm?: boolean;
};

export type ScriptGenerateInput = {
    stage: ScriptStage;
    source: string;
    options?: ScriptOptions;
    setting?: string;
    outline?: string;
    script?: string;
    assets?: string;
    shot?: string;
    preamble?: string;
    feedback?: string;
    episode?: number;
    episodeTotal?: number;
    episodeOutline?: string;
};

/** MiniMax H3 的尺寸预设（32 整数倍对齐），与前端 video-minimax-h3-omni 保持一致。 */
const H3_SIZES: string[] = [
    "864x480", "480x864",
    "960x544", "544x960",
    "1056x608", "608x1056",
    "1152x640", "640x1152",
    "1216x672", "672x1216",
    "1280x736", "736x1280",
    "1344x768", "768x1344",
    "1376x768", "768x1376",
    "1504x832", "832x1504",
    "1664x928", "928x1664",
    "1824x1024", "1024x1824",
    "1920x1088", "1088x1920",
];

const MAX_SOURCE_LENGTH = 60000;
const CONDENSE_CHUNK_SIZE = 6000;
const CONDENSE_MAX_CHUNKS = 30;
const CONDENSE_SYSTEM_PROMPT = "你是资深小说编辑，负责把长篇小说提炼成可用于短剧改编的故事素材。保留人物、关系、主线事件、关键场景、冲突和标志性台词，删除重复描写与无关支线。只输出结果，不要寒暄。";
const SCRIPT_SYSTEM_PROMPT = `你是短剧剧本改编专家，熟悉短剧结构、节奏和平台受众。你的任务是把用户提供的小说或故事改编成可拍摄的短剧剧本。

创作原则：
1. 保留原作的核心设定、人物关系和情感主线，除非用户明确要求修改。
2. 短剧化：开篇尽快建立核心冲突；每集都有推进、反转或情绪回报；集尾留下悬念。
3. 台词口语化、有张力，避免书面解释；用动作、冲突和选择传递信息。
4. 严格只输出当前阶段要求的内容，不要提前写下一阶段。
5. 使用简体中文 Markdown，标题层级清晰，不要输出多余寒暄。`;

const SCRIPT_JSON_SYSTEM_PROMPT = `你是短剧资产与分镜结构化专家，输出必须严格符合要求的 JSON 结构，供程序直接解析。

硬性规则：
1. 只输出一个合法 JSON 对象，不要输出 Markdown 代码块标记、注释、解释或任何多余文字。
2. 所有字段名、枚举值必须与要求完全一致，不得新增、改名或省略必填字段。
3. 引用资产只能使用给定的 id 或「类型：名称」，不得编造不存在的资产。
4. 严格只输出当前阶段要求的内容，不要提前写下一阶段。`;

const JSON_STAGES: ScriptStage[] = ["assets", "storyboard", "shot"];

/** 按阶段生成剧本内容，固定使用 Chat Completions 以兼容各类聚合平台。 */
export async function generateScriptStage(config: CanvasAgentConfig, input: ScriptGenerateInput, fetchImpl: typeof fetch = fetch) {
    const current = getOpenAiConfig(config);
    if (!current.apiKey) throw new OpenAiTurnError("请先在 Agent 设置中配置 OpenAI API Key", 400);
    const source = String(input.source || "").trim();
    if (!source) throw new OpenAiTurnError("请先输入要改编的原文", 400);
    if (!["setting", "outline", "script", "assets", "storyboard", "shot", "condense"].includes(input.stage)) throw new OpenAiTurnError("未知的剧本阶段", 400);
    if (input.stage === "condense") return { content: await condenseSource(current, source, input.preamble, fetchImpl) };
    if ((input.stage === "storyboard" || input.stage === "shot") && !input.episode) throw new OpenAiTurnError("分镜阶段必须指定集号", 400);
    if (source.length > MAX_SOURCE_LENGTH) throw new OpenAiTurnError(`原文超过 ${MAX_SOURCE_LENGTH / 10000} 万字，请先分卷或精简后再改编`, 400);

    const system = withPreamble(JSON_STAGES.includes(input.stage) ? SCRIPT_JSON_SYSTEM_PROMPT : SCRIPT_SYSTEM_PROMPT, input.preamble);
    const content = await requestChat(current, [
        { role: "system", content: system },
        { role: "user", content: buildStagePrompt(input, source) },
    ], fetchImpl);
    if (!content.trim()) throw new OpenAiTurnError("模型没有返回剧本内容，请重试", 502);
    return { content };
}

type ChatConfig = ReturnType<typeof getOpenAiConfig>;

async function requestChat(current: ChatConfig, messages: Array<{ role: string; content: string }>, fetchImpl: typeof fetch) {
    const url = apiUrl(current.baseUrl, "/chat/completions");
    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${current.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ model: current.model, messages, temperature: 0.8, max_tokens: 16000 }),
            signal: AbortSignal.timeout(240000),
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new OpenAiTurnError("剧本生成超时，请缩短原文或减少集数后重试", 504);
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        throw new OpenAiTurnError(`无法连接 ${url}（${cause?.code || cause?.message || errorMessage(error)}）。请检查 Base URL、网络或代理。`, 502);
    }

    const text = await response.text();
    let body: {
        choices?: Array<{ finish_reason?: string; message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
        usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
        error?: { message?: string };
    } = {};
    try {
        body = text ? JSON.parse(text) as typeof body : {};
    } catch {
        if (response.ok) throw new OpenAiTurnError("剧本接口返回了无效的 JSON 响应", 502);
    }
    if (!response.ok) {
        const detail = body.error?.message || response.statusText || "未知错误";
        if (response.status === 401) throw new OpenAiTurnError(`API Key 无效或无该模型权限（401）：${detail}`, 401);
        if (response.status === 404) {
            if (/model|not\s*found/i.test(detail)) throw new OpenAiTurnError(`模型不存在或无权限（404）：${detail}。请在 Agent 设置中重新选择模型。`, 404);
            throw new OpenAiTurnError(`当前 Base URL 不支持 /chat/completions（404）：${detail}`, 404);
        }
        throw new OpenAiTurnError(`剧本生成失败（${response.status}）：${detail}`, 502);
    }
    const content = normalizeContent(body.choices?.[0]?.message?.content);
    if (!content.trim()) {
        const finishReason = body.choices?.[0]?.finish_reason;
        const reasoningTokens = body.usage?.completion_tokens_details?.reasoning_tokens;
        if (finishReason === "length") throw new OpenAiTurnError(`模型生成达到长度上限且未输出正文（推理 tokens：${reasoningTokens ?? "未知"}），请减少集数或拆批生成`, 502);
        throw new OpenAiTurnError(`模型返回空内容（结束原因：${finishReason || "未知"}），请重试或更换模型`, 502);
    }
    return content;
}

/** 长篇小说先分章提炼，再合并为可用于改编的故事素材。 */
async function condenseSource(current: ChatConfig, source: string, preamble: string | undefined, fetchImpl: typeof fetch) {
    const chunks = splitLongText(source, CONDENSE_CHUNK_SIZE);
    if (chunks.length > CONDENSE_MAX_CHUNKS) {
        throw new OpenAiTurnError(`选中的原文约 ${Math.ceil(source.length / 10000)} 万字，超过自动提炼上限，请减少章节后再试`, 400);
    }
    const system = withPreamble(CONDENSE_SYSTEM_PROMPT, preamble);
    const summaries: string[] = [];
    for (const [index, chunk] of chunks.entries()) {
        summaries.push(await requestChat(current, [
            { role: "system", content: system },
            { role: "user", content: `这是原文第 ${index + 1}/${chunks.length} 段。请提炼为 1800 字以内的剧情素材，保留人物、关系、主线事件、关键场景、冲突、标志性台词和可用于画面的细节（外貌、服装、陈设）。\n\n${chunk}` },
        ], fetchImpl));
    }
    let merged = summaries.join("\n\n");
    while (merged.length > 18000 && summaries.length > 1) {
        const next: string[] = [];
        for (let index = 0; index < summaries.length; index += 4) {
            const group = summaries.slice(index, index + 4);
            if (group.length === 1) {
                next.push(group[0]);
                continue;
            }
            next.push(await requestChat(current, [
                { role: "system", content: system },
                { role: "user", content: `请把以下分段摘要合并成一份完整故事素材，不超过 12000 字，保留人物关系、主线因果、关键场景和冲突。\n\n${group.join("\n\n")}` },
            ], fetchImpl));
        }
        summaries.splice(0, summaries.length, ...next);
        merged = summaries.join("\n\n");
    }
    return merged;
}

function withPreamble(base: string, preamble: string | undefined) {
    const extra = String(preamble || "").trim();
    if (!extra) return base;
    return `${base}\n\n用户为本项目设定的创作规则（在不违反上述原则的前提下优先遵循）：\n${extra}`;
}

function splitLongText(text: string, size: number) {
    const paragraphs = text.split(/\n+/);
    const chunks: string[] = [];
    let current = "";
    for (const paragraph of paragraphs) {
        if (current.length + paragraph.length + 1 > size && current) {
            chunks.push(current);
            current = paragraph;
        } else {
            current = current ? `${current}\n${paragraph}` : paragraph;
        }
        while (current.length > size) {
            chunks.push(current.slice(0, size));
            current = current.slice(size);
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function normalizeContent(content: string | Array<{ type?: string; text?: string }> | undefined) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((part) => part?.text).map((part) => String(part.text)).join("\n");
}

function buildStagePrompt(input: ScriptGenerateInput, source: string) {
    const options = input.options || {};
    const episode = clampNumber(input.episode, 0, 200, 0);
    const episodeTotal = clampNumber(input.episodeTotal, 1, 200, episode || 1);
    const episodeScope = episode ? `（第 ${episode}/${episodeTotal} 集）` : "";
    const meta = [
        `目标集数：${clampNumber(options.episodes, 1, 100, 12)} 集`,
        `单集时长：${clampNumber(options.duration, 15, 600, 60)} 秒`,
        `题材：${options.genre?.trim() || "由原文提炼"}`,
        `受众：${options.audience?.trim() || "短剧平台泛用户"}`,
        `画幅：${options.orientation === "horizontal" ? "横屏" : "竖屏"}`,
        options.keep?.trim() ? `必须保留：${options.keep.trim()}` : "",
        options.change?.trim() ? `允许调整：${options.change.trim()}` : "",
        `字幕：${options.subtitle === false ? "关闭" : "开启"}`,
        `BGM：${options.bgm === false ? "关闭" : "开启"}`,
        input.feedback?.trim() ? `本次修改要求：${input.feedback.trim()}` : "",
    ].filter(Boolean).join("\n");

    if (input.stage === "setting") {
        return `阶段一：故事设定。

${meta}

原文：
${source}

请输出：
## 一句话故事
## 题材与受众
## 核心冲突
## 人物小传（每人包含：目标、动机、阻力、关系、人物变化）
## 世界观与主要场景
## 情绪价值与爽点
## 视觉风格与色彩（写实/动画、时代、镜头质感、光线与色彩的统一规则）
## 表演与声音基调（对白语言、表演风格、环境声与配乐原则）
## 短剧化策略（开场钩子、反转节点、节奏控制）`;
    }

    if (input.stage === "outline") {
        return `阶段二：分集大纲。

${meta}

已确认的故事设定：
${input.setting?.trim() || "（未提供，请先根据原文自行提炼）"}

原文（用于核对细节）：
${source}

请按 ${clampNumber(options.episodes, 1, 100, 12)} 集输出分集大纲，每集格式：
### 第X集 集名
- 核心事件：
- 开场钩子：
- 节拍（3-5 条）：
- 集尾悬念：

要求：主线清晰、冲突逐集升级、每集有独立爽点或反转，集与集之间因果成立。`;
    }

    if (input.stage === "assets") {
        return `阶段四：资产拆解。

${meta}

故事设定：
${input.setting?.trim() || "（未提供）"}

完整分集大纲（用于保持资产命名一致）：
${input.outline?.trim() || "（未提供）"}

完整剧本正文：
${input.script?.trim() || "（未提供）"}

请拆解完整剧本实际需要的角色、场景与道具。参考视频与参考音频不属于资产，由用户在画布上自行上传，不要生成这两类资产。

输出契约（必须严格遵守）：
- 只输出一个 JSON 对象，不要输出 Markdown、代码块标记、解释或任何多余文字。
- 结构：{"assets":[{"kind":"character","name":"姓名","description":"定位/外貌/服装/性格概述","prompt":"图像生成提示词","h3":{"subject_definitions":"...","retention_analysis":"...","summary":"...","overall_soundscape":"...","non_diegetic_music":"...","detailed_description":"..."},"variants":[{"name":"形态名","description":"该形态与基础形象的差异","prompt":"该形态的图像生成提示词","h3":{"subject_definitions":"...","retention_analysis":"..."}}]}]}
- kind 只能是 character、scene、prop 之一；name 与大纲、正文保持一致，同一资产只出现一次，跨集信息合并到同一条。
- prompt 是该资产的基础图像生成提示词；character/scene/prop 的 prompt 用于图像生成。
- variants 是该资产下的不同形态，例如角色的常服与雨夜造型、场景的白天与夜晚、道具的完整与破损。每个形态会独立对应画布上一个参考节点，镜头引用的是形态。
- 没有多个形态时给一个形态，其 name 留空即可，prompt 与资产 prompt 保持一致。
- h3 是该资产在 MiniMax H3 视频提示词中的参考字段模板，描述这个参考对象在视频里长什么样、必须保留什么特征，会被自动合并进引用它的每个镜头。
- h3 字段按 kind 只填以下这些，其余字段留空字符串或不写：
  - character：subject_definitions（外貌/发型/服装/气质）、retention_analysis（必须保留的五官比例、发型走向、服装版型配色等）、summary（性格与表演基调）、overall_soundscape（声线音色语速）。
  - scene：subject_definitions（空间结构/时代/材质/陈设/光线）、retention_analysis（必须保留的空间与光线特征）、overall_soundscape（环境音底噪）。
  - prop：subject_definitions（单个物体的轮廓与材质）、retention_analysis（必须保留的形制与材质细节）。
- h3 正文使用英文，内容具体精炼；绝对不要写 <Picture N> / <Subject N> / <Video N> / <Audio N> 这类编号，编号由画布连线顺序自动注入。

要求：
1. 角色 prompt 包含年龄、外貌、发型、服装、气质和统一视觉风格；参考图应为单人、清晰正面或三分之二侧面、全身或大半身，避免多人、拼贴、文字和水印。
2. 场景参考图尽量无主要人物，固定空间结构、时代、材质、陈设、时间和光线；不同时间或关键状态应拆成不同形态。
3. 道具参考图突出单个物体、轮廓和材质；完整、破损等关键状态应拆成不同形态。
4. 形态之间只在真正影响一致性的维度上区分（服装、光线、状态），不要为凑数量拆分。
5. 不要生成参考视频或参考音频条目。`;
    }

    if (input.stage === "storyboard" && episode) {
        return `阶段五：分镜脚本${episodeScope}。

${meta}

故事设定：
${input.setting?.trim() || "（未提供）"}

完整分集大纲（用于保持前后连贯）：
${input.outline?.trim() || "（未提供）"}

本集大纲：
${input.episodeOutline?.trim() || "（未提供）"}

本集剧本正文：
${input.script?.trim() || "（未提供）"}

资产清单（引用时必须与下面完全一致）：
${input.assets?.trim() || "（未提供）"}

请只把第 ${episode} 集拆成可直接交给 ComfyUI MiniMax H3 的视频生成段，不要输出其他集。

输出契约（必须严格遵守）：
- 只输出一个 JSON 对象，不要输出 Markdown、代码块标记、解释或任何多余文字。
- 结构：{"episode":{"title":"第${episode}集 集名","shots":[{"number":1,"title":"镜头标题","duration":5,"size":"${defaultSize(options.orientation)}","imageAssets":["资产id或类型：名称"],"blocking":{"characterIds":["形态id"],"positions":{"形态id":"画面左侧，背对镜头"},"continuous":true},"consistency":{"carryOverAssetIds":["形态id"],"notes":"需与上一镜头保持一致的说明"},"h3":{"subject_definitions":"...","summary":"...","retention_analysis":"...","detailed_description":"...","overall_soundscape":"...","non_diegetic_music":"..."}}]}}
- duration 为 1-15 的整数秒；本集各段时长合计约 ${clampNumber(options.duration, 15, 600, 60)} 秒。
- size 只能取以下值之一（当前画幅预设）：${sizeList(options.orientation).join("、")}
- imageAssets 只能引用资产清单里的角色、场景与道具，最多 9 个；参考视频与参考音频由用户在画布上自行上传并连线，不要在 JSON 里输出 videoAssets 或 audioAssets。
- 需要引用某个资产的具体形态时，写「资产id:形态名」或「资产id:形态名」对应的资产名加形态名；不指定形态时默认取该资产的第一个形态。
- 不要凑数量引用无关资产。
- 引用顺序即编号顺序：第 N 个参考图片对应 <Picture N>；编号从 1 连续开始，不得跳号。
- h3 六个字段都必须非空；subject_definitions 用 <Subject N> 定义第 N 张图片主体并通过 <Picture N> 绑定；外观、服装、场景与道具只能复用资产设定，不得重新编造。
- 资产清单里带「H3参考字段」的条目，其主体外观与保留特征会由系统自动合并进本镜头；你写 h3 时不要重复抄写这些外观细节（否则会重复），只写本镜头特有的叙事内容。
- 若某个资产带有 H3参考字段，则该资产在 h3 中对应的字段可以只写本镜头场景下的补充描述；若不带，则需完整描述该主体。
- h3 正文使用英文，内容完整但精炼；detailed_description 使用 [Shot N] 与 from ... to ... 时间轴，覆盖本段全部时长。
${subtitleRule(options)}
${bgmRule(options)}
- blocking 是空间站位声明：characterIds 写参与站位的角色形态 ID（必须来自 imageAssets），positions 为每个角色写一句站位描述（如「画面左侧，背对镜头」）；当本镜头与上一镜头存在剧情衔接、需要保持人物空间关系时，continuous 写 true，并明确写出「上一镜头结束时 X 位于……，本镜头保持该站位」。不涉及站位时整个 blocking 可省略。
- consistency 是一致性声明：carryOverAssetIds 写必须与上一镜头保持一致的形态 ID（必须来自 imageAssets），notes 用一句话说明需要保持一致的视觉特征（如「李明仍穿同一件灰色风衣」）。无需要时整个 consistency 可省略。
- 严格按本集大纲与正文，不新增剧情。`;
    }

    if (input.stage === "shot") {
        return `阶段五：单镜头重写${episodeScope}。

${meta}

故事设定：
${input.setting?.trim() || "（未提供）"}

本集大纲：
${input.episodeOutline?.trim() || "（未提供）"}

本集剧本正文：
${input.script?.trim() || "（未提供）"}

资产清单（引用时必须与下面完全一致）：
${input.assets?.trim() || "（未提供）"}

需要重写的镜头：
${input.shot?.trim() || "（未提供）"}

请只重写这一个镜头，其余镜头保持不变。

输出契约（必须严格遵守）：
- 只输出一个 JSON 对象：{"shot":{"number":原序号,"title":"镜头标题","duration":5,"size":"${defaultSize(options.orientation)}","imageAssets":["资产id或类型：名称"],"blocking":{"characterIds":["形态id"],"positions":{"形态id":"画面左侧，背对镜头"},"continuous":true},"consistency":{"carryOverAssetIds":["形态id"],"notes":"需与上一镜头保持一致的说明"},"h3":{"subject_definitions":"...","summary":"...","retention_analysis":"...","detailed_description":"...","overall_soundscape":"...","non_diegetic_music":"..."}}}
- 保持 number 与原来一致；duration 为 1-15 的整数秒；size 只能取：${sizeList(options.orientation).join("、")}
- 引用与 h3 的编号规则、英文正文与时间轴要求同分镜阶段；只引用资产清单中已存在的资产。
${subtitleRule(options)}
${bgmRule(options)}
- blocking 与 consistency 的写法同分镜阶段；需要保持与上一镜头一致的空间站位时必须写 continuous 为 true。`;
    }

    if (episode) {
        return `阶段三：剧本正文${episodeScope}。

${meta}

已确认的故事设定：
${input.setting?.trim() || "（未提供）"}

完整分集大纲（用于保持前后连贯，不要重复其他集内容）：
${input.outline?.trim() || "（未提供）"}

本集大纲：
${input.episodeOutline?.trim() || `（未提供，请按完整大纲中第 ${episode} 集的内容）`}

原文或素材（用于核对人物、台词与细节）：
${source}

请只写第 ${episode} 集的剧本正文，不要写其他集，也不要复述前情。格式：
### 第${episode}集 集名
#### 第X场 地点 时间 内景/外景
- 人物：
- 画面与动作：
- 对白：
- 镜头提示：

要求：
1. 台词口语化，避免解释性独白，用冲突和动作推进。
2. 每场戏有明确目的，删掉不推动剧情的过场。
3. 本集内容量匹配 ${clampNumber(options.duration, 15, 600, 60)} 秒时长。
4. 严格按本集大纲展开，不新增偏离主线的支线。
5. 人物称呼、地名、关键道具必须与故事设定和大纲一致。`;
    }

    return `阶段三：剧本正文。

${meta}

已确认的故事设定：
${input.setting?.trim() || "（未提供）"}

已确认的分集大纲：
${input.outline?.trim() || "（未提供）"}

原文（用于核对人物与细节）：
${source}

请按大纲逐集写出可拍摄的剧本正文。每集格式：
### 第X集 集名
#### 第X场 地点 时间 内景/外景
- 人物：
- 画面与动作：
- 对白：
- 镜头提示：

要求：
1. 台词口语化，避免解释性独白，用冲突和动作推进。
2. 每场戏有明确目的，删掉不推动剧情的过场。
3. 单集内容量匹配 ${clampNumber(options.duration, 15, 600, 60)} 秒时长。
4. 严格按分集大纲展开，不新增偏离主线的支线。`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** 字幕开关对应的提示词规则。 */
function subtitleRule(options: ScriptOptions) {
    if (options.subtitle === false) return "- 字幕已关闭：不要输出任何 <d>...</d> 台词片段，也不要在 detailed_description 里写对白内容。";
    return "- 台词保留剧情关键句并标说话人，中文台词写成 <d>[Chinese] Speaker (voice and emotion):「台词」</d>。";
}

/** BGM 开关对应的提示词规则。 */
function bgmRule(options: ScriptOptions) {
    if (options.bgm === false) return "- BGM 已关闭：non_diegetic_music 必须留空字符串。";
    return "- non_diegetic_music 写本镜头的非叙事配乐（情绪、乐器、节奏、进入与退出点），没有配乐时留空字符串。";
}

/** 按画幅返回允许的 H3 尺寸预设。 */
function sizeList(orientation: ScriptOptions["orientation"]) {
    const vertical = orientation !== "horizontal";
    return H3_SIZES.filter((size) => {
        const [w, h] = size.split("x").map(Number);
        return vertical ? h > w : w > h;
    });
}

/** 取当前画幅预设的中间档，作为分镜默认尺寸。 */
function defaultSize(orientation: ScriptOptions["orientation"]) {
    const list = sizeList(orientation);
    return list[Math.floor(list.length / 2)] || (orientation === "horizontal" ? "1344x768" : "768x1344");
}
