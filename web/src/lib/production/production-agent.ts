import { formatAssetList, parseGeneratedAssets, parseGeneratedEpisode, parseGeneratedShot, parseOutlineMarkdown, serializeOutline } from "@/lib/production/production-model";
import { runProductionAgent as callProductionAgent, type ProductionAgentRequest, type ProductionAgentResult, type ProductionAgentState } from "@/services/api/canvas-agent";
import type { ProductionEpisode, ProductionState, ScriptShot } from "@/types/canvas";

/**
 * 把生产态压缩成 Agent 能读懂的状态快照。
 * Agent 据此判断项目真实进度，而不是靠前端告诉它「现在是第几阶段」。
 */
export function buildProductionAgentState(data: ProductionState): ProductionAgentState {
    return {
        source: data.source.text,
        condensed: data.source.condensed,
        setting: data.setting,
        outline: serializeOutline(data.episodes),
        script: data.episodes.map((episode) => episode.script).filter(Boolean).join("\n\n"),
        assets: formatAssetList(data.assets),
        episodes: data.episodes.map((episode) => ({
            number: episode.number,
            title: episode.title,
            synopsis: episode.synopsis,
            script: episode.script,
            shotCount: episode.shots.length,
        })),
        assetCount: data.assets.length,
        shotCount: data.episodes.reduce((total, episode) => total + episode.shots.length, 0),
        options: data.options,
    };
}

/** Agent 产出回写到生产态的结果。 */
export type ProductionAgentWriteback = {
    /** 回写后的生产态；无变化时为 null。 */
    data: Partial<ProductionState> | null;
    /** 产出所属集号，用于定位。 */
    episodeNumber: number;
    /** 是否产生了有效产出。 */
    hasContent: boolean;
};

/**
 * 把 Agent 的产出按阶段解析并回写到生产态。
 * 与固定流水线共用同一套解析函数，保证 Agent 自主产出与手动生成的结构完全一致。
 */
export function applyProductionAgentResult(current: ProductionState, result: ProductionAgentResult): ProductionAgentWriteback {
    const content = result.content.trim();
    if (!content) return { data: null, episodeNumber: result.plan.episode, hasContent: false };
    const stage = result.plan.stage;

    if (stage === "condense") {
        return { data: { source: { ...current.source, condensed: content } }, episodeNumber: 0, hasContent: true };
    }
    if (stage === "setting") {
        return { data: { setting: content }, episodeNumber: 0, hasContent: true };
    }
    if (stage === "outline") {
        const parsed = parseOutlineMarkdown(content);
        if (!parsed.length) return { data: null, episodeNumber: 0, hasContent: false };
        const episodes: ProductionEpisode[] = parsed.map((item, index) => {
            const existing = current.episodes[index];
            return existing
                ? { ...existing, number: index + 1, title: item.title, synopsis: item.synopsis }
                : { id: `episode-${index + 1}-${Date.now()}`, number: index + 1, title: item.title, synopsis: item.synopsis, script: "", shots: [] };
        });
        return { data: { episodes }, episodeNumber: 0, hasContent: true };
    }
    if (stage === "script") {
        const number = result.plan.episode || current.episodes[0]?.number || 1;
        const target = current.episodes.find((episode) => episode.number === number) || current.episodes[0];
        if (!target) return { data: null, episodeNumber: number, hasContent: false };
        const titleMatch = content.match(/^\s*#{1,4}\s*(第[^\n]*集[^\n]*)$/m);
        const title = titleMatch ? titleMatch[1].trim() : target.title;
        const body = titleMatch ? content.replace(/^\s*#{1,4}\s*第[^\n]*集[^\n]*\n?/m, "").trim() : content;
        const episodes = current.episodes.map((episode) => (episode.id === target.id ? { ...episode, title, script: body } : episode));
        return { data: { episodes }, episodeNumber: number, hasContent: true };
    }
    if (stage === "assets") {
        const assets = parseGeneratedAssets(content);
        return { data: { assets }, episodeNumber: 0, hasContent: true };
    }
    if (stage === "storyboard") {
        const number = result.plan.episode || current.episodes[0]?.number || 1;
        const target = current.episodes.find((episode) => episode.number === number) || current.episodes[0];
        if (!target) return { data: null, episodeNumber: number, hasContent: false };
        const parsed = parseGeneratedEpisode(content, current.assets, current.options.orientation);
        const episodes = current.episodes.map((episode) => (episode.id === target.id ? { ...episode, title: parsed.title || episode.title, shots: parsed.shots } : episode));
        return { data: { episodes }, episodeNumber: number, hasContent: true };
    }
    if (stage === "shot") {
        const number = result.plan.episode || current.episodes[0]?.number || 1;
        const target = current.episodes.find((episode) => episode.number === number) || current.episodes[0];
        const shotId = findShotIdByNumber(current, number, result);
        const existing = target?.shots.find((shot) => shot.id === shotId);
        if (!target || !existing) return { data: null, episodeNumber: number, hasContent: false };
        const next: ScriptShot = parseGeneratedShot(content, existing, current.assets, current.options.orientation);
        const episodes = current.episodes.map((episode) => (episode.id === target.id ? { ...episode, shots: episode.shots.map((shot) => (shot.id === existing.id ? { ...next, id: existing.id, number: existing.number } : shot)) } : episode));
        return { data: { episodes }, episodeNumber: number, hasContent: true };
    }
    return { data: null, episodeNumber: result.plan.episode, hasContent: false };
}

/** 定位要重写的镜头：优先按传入的镜头 JSON 里的 id / number 匹配。 */
function findShotIdByNumber(current: ProductionState, episodeNumber: number, result: ProductionAgentResult) {
    try {
        const payload = JSON.parse(result.content) as { shot?: { number?: number; id?: string } };
        const wanted = payload.shot?.number;
        if (wanted) {
            const episode = current.episodes.find((item) => item.number === episodeNumber);
            const found = episode?.shots.find((shot) => shot.number === wanted);
            if (found) return found.id;
        }
    } catch {
        // 解析失败时按集内顺序回退。
    }
    const episode = current.episodes.find((item) => item.number === episodeNumber) || current.episodes[0];
    return episode?.shots[0]?.id || "";
}

/** 调用自主生产 Agent 并回写生产态。 */
export async function runProductionAgentStep(params: {
    endpoint: string;
    token: string;
    goal: string;
    mode: "auto" | "stage";
    stage?: ProductionAgentRequest["stage"];
    state: ProductionState;
    preamble?: string;
    instruction?: string;
    episode?: number;
    episodeTotal?: number;
    episodeOutline?: string;
    shot?: string;
}) {
    const result = await callProductionAgent(params.endpoint, params.token, {
        goal: params.goal,
        mode: params.mode,
        stage: params.stage,
        state: buildProductionAgentState(params.state),
        preamble: params.preamble,
        instruction: params.instruction,
        episode: params.episode,
        episodeTotal: params.episodeTotal,
        episodeOutline: params.episodeOutline,
        shot: params.shot,
    });
    return { result, writeback: applyProductionAgentResult(params.state, result) };
}
