import type { ScriptAdaptRequest, ScriptStage } from "@/services/api/canvas-agent";
import { parseGeneratedAssets, parseGeneratedEpisode, parseGeneratedShot, splitEpisodeBlocks, validateH3Shot, type ScriptEpisodeView } from "@/lib/canvas/script-model";
import type { CanvasScriptOptions, ScriptAsset, ScriptShot, ScriptStoryboardEpisode } from "@/types/canvas";

export type ScriptCaller = (stage: ScriptStage, text: string, extra?: Partial<ScriptAdaptRequest>) => Promise<string>;

/** 按「第X集」把大纲或正文切成每集片段，至少两集才拆分。 */
export function splitEpisodes(text: string) {
    const blocks = splitEpisodeBlocks(text);
    if (blocks.length < 2) return [];
    return blocks.map((block) => `### ${block.title}\n${block.body}`);
}

/** Markdown 阶段（设定 / 大纲 / 正文）编排：正文按集逐段生成，其余单次生成。 */
export async function generateMarkdownStage(params: {
    stage: "setting" | "outline" | "script";
    text: string;
    outline: string;
    call: ScriptCaller;
    onProgress?: (message: string) => void;
    onPart?: (content: string) => void;
    progressLabel?: (current: number, total: number) => string;
}) {
    const { stage, text, outline, call, onProgress, onPart, progressLabel } = params;
    const episodes = stage === "script" ? splitEpisodes(outline) : [];
    if (!episodes.length) return call(stage, text);
    const parts: string[] = [];
    for (const [index, episodeOutline] of episodes.entries()) {
        onProgress?.(progressLabel?.(index + 1, episodes.length) || "");
        const content = await call(stage, text, { episode: index + 1, episodeTotal: episodes.length, episodeOutline });
        parts.push(content.trim());
        onPart?.(parts.join("\n\n"));
    }
    return parts.join("\n\n");
}

/** 全剧资产：单次 JSON 生成，严格校验后一次性返回，失败不提交半截结果。 */
export async function generateAssetsContent(params: { text: string; call: ScriptCaller }): Promise<ScriptAsset[]> {
    return parseGeneratedAssets(await params.call("assets", params.text));
}

async function generateStoryboardEpisode(params: {
    episode: ScriptEpisodeView;
    episodeTotal: number;
    assets: ScriptAsset[];
    orientation?: CanvasScriptOptions["orientation"];
    text: string;
    call: ScriptCaller;
}): Promise<ScriptStoryboardEpisode> {
    const { episode, episodeTotal, assets, orientation, text, call } = params;
    if (!episode.script.trim()) throw new Error(`第 ${episode.number} 集缺少剧本正文，请先生成本集正文再生成分镜`);
    const content = await call("storyboard", text, {
        episode: episode.number,
        episodeTotal,
        episodeOutline: episode.outline,
        script: episode.script,
    });
    const parsed = parseGeneratedEpisode(content, assets, orientation);
    const storyboard: ScriptStoryboardEpisode = { id: episode.id, number: episode.number, title: parsed.title || episode.title, shots: parsed.shots };
    for (const shot of storyboard.shots) {
        const errors = validateH3Shot(shot, assets, orientation);
        if (errors.length) throw new Error(`第 ${episode.number} 集「${shot.title || "未命名镜头"}」校验失败：${errors.join("；")}`);
    }
    return storyboard;
}

/** 全剧分镜：逐集生成 H3 JSON，全部解析与交叉校验通过后一次性返回，任一集失败不提交。 */
export async function generateStoryboardContent(params: {
    episodes: ScriptEpisodeView[];
    assets: ScriptAsset[];
    orientation?: CanvasScriptOptions["orientation"];
    text: string;
    call: ScriptCaller;
    onProgress?: (message: string) => void;
    progressLabel?: (current: number, total: number) => string;
}): Promise<ScriptStoryboardEpisode[]> {
    const { episodes, assets, orientation, text, call, onProgress, progressLabel } = params;
    if (!episodes.length) throw new Error("没有可分镜的分集，请先生成分集大纲与正文");
    const results: ScriptStoryboardEpisode[] = [];
    for (const [index, episode] of episodes.entries()) {
        onProgress?.(progressLabel?.(index + 1, episodes.length) || "");
        results.push(await generateStoryboardEpisode({ episode, episodeTotal: episodes.length, assets, orientation, text, call }));
    }
    return results;
}

/** 单集分镜重生成：仅返回该集结构，失败保留旧分镜。 */
export async function generateEpisodeContent(params: {
    episode: ScriptEpisodeView;
    episodeTotal: number;
    assets: ScriptAsset[];
    orientation?: CanvasScriptOptions["orientation"];
    text: string;
    call: ScriptCaller;
}): Promise<ScriptStoryboardEpisode> {
    return generateStoryboardEpisode(params);
}

/** 单镜头重生成：保留原镜头 ID 与序号，失败保留旧镜头。 */
export async function generateShotContent(params: {
    episode: ScriptEpisodeView;
    episodeTotal: number;
    shot: ScriptShot;
    assets: ScriptAsset[];
    orientation?: CanvasScriptOptions["orientation"];
    text: string;
    call: ScriptCaller;
    feedback?: string;
}): Promise<ScriptShot> {
    const { episode, episodeTotal, shot, assets, orientation, text, call, feedback } = params;
    if (!episode.script.trim()) throw new Error(`第 ${episode.number} 集缺少剧本正文，请先生成本集正文再生成分镜`);
    const content = await call("shot", text, {
        episode: episode.number,
        episodeTotal,
        episodeOutline: episode.outline,
        script: episode.script,
        shot: JSON.stringify(shot),
        feedback,
    });
    const next = parseGeneratedShot(content, shot, assets, orientation);
    const errors = validateH3Shot(next, assets, orientation);
    if (errors.length) throw new Error(`「${next.title || "未命名镜头"}」校验失败：${errors.join("；")}`);
    return next;
}
