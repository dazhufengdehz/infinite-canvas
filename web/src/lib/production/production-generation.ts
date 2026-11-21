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

/** 故事设定：单次 Markdown 生成。 */
export async function generateSetting(params: { text: string; call: ProductionCaller; feedback?: string }) {
    return params.call("setting", params.text, params.feedback ? { feedback: params.feedback } : undefined);
}

/** 分集大纲：单次 Markdown 生成后解析为「集标题 + 梗概」。 */
export async function generateOutline(params: { text: string; setting: string; call: ProductionCaller; feedback?: string }) {
    const content = await params.call("outline", params.text, { setting: params.setting, ...(params.feedback ? { feedback: params.feedback } : {}) });
    const episodes = parseOutlineMarkdown(content);
    if (!episodes.length) throw new Error(t("canvas.production.error.outlineEmpty"));
    return episodes;
}

/** 单集正文：只写目标集，携带完整大纲与本集大纲。 */
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
    return content.trim();
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

/** 单集分镜：逐集生成 H3 JSON，解析与交叉校验通过后返回该集镜头。 */
export async function generateEpisodeStoryboard(params: {
    episode: ProductionEpisode;
    episodes: ProductionEpisode[];
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    text: string;
    setting: string;
    call: ProductionCaller;
    feedback?: string;
}) {
    const { episode, episodes, assets, orientation, text, setting, call, feedback } = params;
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
    for (const shot of parsed.shots) {
        const errors = validateShot(shot, assets, orientation);
        if (errors.length) throw new Error(t("canvas.production.error.episodeInvalid", { number: episode.number, title: shot.title || t("canvas.production.error.unnamedShot"), errors: errors.join("；") }));
    }
    return { title: parsed.title || episode.title, shots: parsed.shots };
}

/** 单镜头重生成：保留原镜头 ID 与序号，失败保留旧镜头。 */
export async function generateShot(params: {
    episode: ProductionEpisode;
    episodes: ProductionEpisode[];
    shot: ScriptShot;
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    text: string;
    setting: string;
    call: ProductionCaller;
    feedback?: string;
}) {
    const { episode, episodes, shot, assets, orientation, text, setting, call, feedback } = params;
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
        ...(feedback ? { feedback } : {}),
    });
    const next = parseGeneratedShot(content, shot, assets, orientation);
    const errors = validateShot(next, assets, orientation);
    if (errors.length) throw new Error(t("canvas.production.error.shotInvalid", { title: next.title || t("canvas.production.error.unnamedShot"), errors: errors.join("；") }));
    return next;
}

/** 全剧分镜：逐集生成，全部成功后再一次性提交；任一集失败不提交半截结果。 */
export async function generateAllStoryboards(params: {
    episodes: ProductionEpisode[];
    assets: ScriptAsset[];
    orientation: ProductionOptions["orientation"];
    text: string;
    setting: string;
    call: ProductionCaller;
    onProgress?: (message: string) => void;
    progressLabel?: (current: number, total: number) => string;
}) {
    const { episodes, assets, orientation, text, setting, call, onProgress, progressLabel } = params;
    const results: { episodeId: string; title: string; shots: ScriptShot[] }[] = [];
    for (const [index, episode] of episodes.entries()) {
        onProgress?.(progressLabel?.(index + 1, episodes.length) || "");
        const result = await generateEpisodeStoryboard({ episode, episodes, assets, orientation, text, setting, call });
        results.push({ episodeId: episode.id, ...result });
    }
    return results;
}
