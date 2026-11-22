import type { ScriptStage } from "@/services/api/canvas-agent";
import { t } from "@/i18n";
import {
    formatAssetList,
    parseGeneratedAssets,
    parseGeneratedEpisode,
    parseGeneratedShot,
    parseOutlineMarkdown,
    serializeOutline,
    validateShot,
} from "@/lib/production/production-model";
import type { ProductionEpisode, ProductionOptions, ScriptAsset, ScriptShot } from "@/types/canvas";

export type ProductionCaller = (stage: ScriptStage, text: string, extra?: Record<string, unknown>) => Promise<string>;

/** 媒体开关：字幕与 BGM 会影响提示词内容，必须贯穿各阶段调用。 */
export type ProductionMediaOptions = Pick<ProductionOptions, "subtitle" | "bgm">;

/** 故事设定：单次 Markdown 生成。 */
export async function generateSetting(params: { text: string; call: ProductionCaller; feedback?: string }) {
    const setting = await params.call("setting", params.text, params.feedback ? { feedback: params.feedback } : undefined);
    return { setting };
}

/** 分集大纲：单次 Markdown 生成后解析为「集标题 + 梗概」。 */
export async function generateOutline(params: { text: string; setting: string; call: ProductionCaller; feedback?: string }) {
    const content = await params.call("outline", params.text, { setting: params.setting, ...(params.feedback ? { feedback: params.feedback } : {}) });
    const episodes = parseOutlineMarkdown(content);
    if (!episodes.length) throw new Error(t("canvas.production.error.outlineEmpty"));
    return episodes;
}

/** 从剧本正文中解析集标题：首行的「### 第X集 集名」。 */
export function parseEpisodeScriptTitle(script: string) {
    const match = script.match(/^\s*#{1,4}\s*(第[^\n]*集[^\n]*)$/m);
    return match ? match[1].trim() : "";
}

/** 单集正文：只写目标集，携带完整大纲与本集大纲；标题与正文一并返回以便回填。 */
export async function generateEpisodeScript(params: {
    episode: ProductionEpisode;
    episodes: ProductionEpisode[];
    setting: string;
    text: string;
    call: ProductionCaller;
    feedback?: string;
}) {
    const { episode, episodes, setting, text, call, feedback } = params;
    const content = await call("script", text, {
        setting,
        outline: serializeOutline(episodes),
        episode: episode.number,
        episodeTotal: episodes.length,
        episodeOutline: episode.synopsis,
        ...(feedback ? { feedback } : {}),
    });
    if (!content.trim()) throw new Error(t("canvas.production.error.scriptEmpty", { number: episode.number }));
    const script = content.trim();
    // 标题行回填到集标题，正文去掉标题行避免重复显示。
    const title = parseEpisodeScriptTitle(script);
    const body = title ? script.replace(/^\s*#{1,4}\s*第[^\n]*集[^\n]*\n?/m, "").trim() : script;
    return { title: title || episode.title, script: body };
}

/** 全剧资产：单次 JSON 生成，严格校验后一次性返回。 */
export async function generateAssets(params: { text: string; setting: string; episodes: ProductionEpisode[]; call: ProductionCaller }) {
    const { text, setting, episodes, call } = params;
    const content = await call("assets", text, {
        setting,
        outline: serializeOutline(episodes),
        script: episodes.map((episode) => episode.script).filter(Boolean).join("\n\n"),
    });
    return parseGeneratedAssets(content);
}

/**
 * 单集分镜：逐集生成 H3 JSON。
 * 已解析的镜头会先通过 onPartial 回调写回，再执行校验；
 * 校验失败只返回缺失项，不再让整集产出作废。
 */
export async function generateEpisodeStoryboard(params: {
    episode: ProductionEpisode;
    episodes: ProductionEpisode[];
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    media?: ProductionMediaOptions;
    text: string;
    setting: string;
    call: ProductionCaller;
    feedback?: string;
    /** 已解析镜头的即时回填回调。 */
    onPartial?: (shots: ScriptShot[]) => void;
}) {
    const { episode, episodes, assets, orientation, media, text, setting, call, feedback, onPartial } = params;
    if (!episode.script.trim()) throw new Error(t("canvas.production.error.missingScript", { number: episode.number }));
    const content = await call("storyboard", text, {
        setting,
        outline: serializeOutline(episodes),
        episode: episode.number,
        episodeTotal: episodes.length,
        episodeOutline: episode.synopsis,
        script: episode.script,
        assets: formatAssetList(assets),
        ...(feedback ? { feedback } : {}),
    });
    const parsed = parseGeneratedEpisode(content, assets, orientation);
    // 先回填已解析结果，避免校验失败导致整集产出丢失。
    onPartial?.(parsed.shots);
    const issues: string[] = [];
    for (const shot of parsed.shots) {
        const errors = validateShot(shot, assets, orientation, media);
        if (errors.length) issues.push(`${shot.title || t("canvas.production.error.unnamedShot")}：${errors.join("；")}`);
    }
    return { title: parsed.title || episode.title, shots: parsed.shots, issues };
}

/** 单镜头重生成：保留原镜头 ID 与序号，失败保留旧镜头。 */
export async function generateShot(params: {
    episode: ProductionEpisode;
    episodes: ProductionEpisode[];
    shot: ScriptShot;
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    media?: ProductionMediaOptions;
    text: string;
    setting: string;
    call: ProductionCaller;
    feedback?: string;
}) {
    const { episode, episodes, shot, assets, orientation, media, text, setting, call, feedback } = params;
    if (!episode.script.trim()) throw new Error(t("canvas.production.error.missingScript", { number: episode.number }));
    const content = await call("shot", text, {
        setting,
        outline: serializeOutline(episodes),
        episode: episode.number,
        episodeTotal: episodes.length,
        episodeOutline: episode.synopsis,
        script: episode.script,
        assets: formatAssetList(assets),
        shot: JSON.stringify(shot),
        ...(media ? { subtitle: media.subtitle, bgm: media.bgm } : {}),
        ...(feedback ? { feedback } : {}),
    });
    const next = parseGeneratedShot(content, shot, assets, orientation);
    const errors = validateShot(next, assets, orientation, media);
    if (errors.length) throw new Error(t("canvas.production.error.shotInvalid", { title: next.title || t("canvas.production.error.unnamedShot"), errors: errors.join("；") }));
    return next;
}

/** 全剧分镜：逐集生成，全部成功后再一次性提交；任一集失败不提交半截结果。 */
export async function generateAllStoryboards(params: {
    episodes: ProductionEpisode[];
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    media?: ProductionMediaOptions;
    text: string;
    setting: string;
    call: ProductionCaller;
    onProgress?: (message: string) => void;
    progressLabel?: (current: number, total: number) => string;
}) {
    const { episodes, assets, orientation, media, text, setting, call, onProgress, progressLabel } = params;
    const results: { episodeId: string; title: string; shots: ScriptShot[]; issues: string[] }[] = [];
    for (const [index, episode] of episodes.entries()) {
        onProgress?.(progressLabel?.(index + 1, episodes.length) || "");
        const result = await generateEpisodeStoryboard({ episode, episodes, assets, orientation, media, text, setting, call });
        results.push({ episodeId: episode.id, ...result });
    }
    return results;
}
