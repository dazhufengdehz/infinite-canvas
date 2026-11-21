import { nanoid } from "nanoid";

import { getDslMiddleSize, MINIMAX_H3_SIZES } from "@/services/api/models/video-minimax-h3-omni";
import type { CanvasScriptOptions, CanvasScriptState, ScriptAsset, ScriptAssetKind, ScriptH3Prompt, ScriptShot } from "@/types/canvas";

export const SCRIPT_ASSET_KINDS: ScriptAssetKind[] = ["character", "scene", "prop", "video", "audio"];
export const SCRIPT_IMAGE_KINDS: ScriptAssetKind[] = ["character", "scene", "prop"];
export const SCRIPT_ASSET_KIND_LABEL: Record<ScriptAssetKind, string> = { character: "角色", scene: "场景", prop: "道具", video: "参考视频", audio: "参考音频" };
export const SCRIPT_H3_SECTIONS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"] as const;

export const SCRIPT_SHOT_LIMITS = { image: 9, video: 3, audio: 3 };
export const SCRIPT_SHOT_DURATION = { min: 1, max: 15 };

const SCRIPT_KIND_BY_LABEL: Record<string, ScriptAssetKind> = { 角色: "character", 场景: "scene", 道具: "prop", 视频: "video", 音频: "audio" };
const EPUB = (id: string) => `episode:${id}`;

export const scriptAssetKey = (id: string) => `asset:${id}`;
export const scriptShotKey = (id: string) => `shot:${id}`;
export const scriptEpisodeKey = (id: string) => EPUB(id);

export function isScriptImageKind(kind: ScriptAssetKind) {
    return SCRIPT_IMAGE_KINDS.includes(kind);
}

export function emptyH3Prompt(): ScriptH3Prompt {
    return { subject_definitions: "", summary: "", retention_analysis: "", detailed_description: "", overall_soundscape: "", non_diegetic_music: "" };
}

export function formatH3Prompt(h3: ScriptH3Prompt) {
    return SCRIPT_H3_SECTIONS.map((section) => `${section}: ${h3[section]?.trim() || ""}`).join("\n");
}

/** 资产显示名：类型 + 名称 + 短 id，用于区分同名资产，引用始终以 id 保存。 */
export function assetLabel(asset: ScriptAsset) {
    return `${SCRIPT_ASSET_KIND_LABEL[asset.kind]} · ${asset.name || "未命名"} · ${asset.id.slice(0, 4)}`;
}

/** 把结构化资产序列化为模型可读清单，模型引用时必须与清单中的 id 或「类型：名称」完全一致。 */
export function formatAssetList(assets: ScriptAsset[]) {
    return assets.map((asset) => `${SCRIPT_ASSET_KIND_LABEL[asset.kind]}：${asset.name}｜id=${asset.id}｜${asset.description}｜参考提示词：${asset.prompt}`).join("\n");
}

export function defaultShotSize(orientation?: CanvasScriptOptions["orientation"]) {
    return getDslMiddleSize(MINIMAX_H3_SIZES, orientation === "horizontal" ? "16:9" : "9:16");
}

export function createScriptShot(orientation?: CanvasScriptOptions["orientation"]): ScriptShot {
    return { id: nanoid(), number: 1, title: "", duration: 5, size: defaultShotSize(orientation), imageAssetIds: [], videoAssetIds: [], audioAssetIds: [], h3: emptyH3Prompt() };
}

export function createScriptAsset(kind: ScriptAssetKind): ScriptAsset {
    return { id: nanoid(), kind, name: "", description: "", prompt: "" };
}

export type ScriptAssetView = ScriptAsset & { key: string };
export type ScriptShotView = ScriptShot & { key: string; episodeId: string; episodeTitle: string };
export type ScriptEpisodeView = { id: string; key: string; number: number; title: string; outline: string; script: string };
export type ScriptProjectView = { episodes: ScriptEpisodeView[]; assets: ScriptAssetView[]; shots: ScriptShotView[] };

const EPISODE_HEADING = /^#{1,4}\s*(第[^\n]*集[^\n]*)$/gm;

/** 按「第X集」标题切分大纲或正文，仅返回每集正文，集序号即数组下标。 */
export function splitEpisodeBlocks(text: string) {
    const matches = [...text.matchAll(EPISODE_HEADING)];
    return matches.map((match, index, all) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = index + 1 < all.length ? all[index + 1].index ?? text.length : text.length;
        return { title: match[1].trim(), body: text.slice(start, end).trim() };
    });
}

/** 按集序号替换 Markdown 正文块，集标题不再作为定位依据。 */
export function replaceEpisodeBlock(text: string, episodeNumber: number, content: string) {
    const matches = [...text.matchAll(EPISODE_HEADING)];
    const target = matches[episodeNumber - 1];
    if (!target || target.index === undefined) return null;
    const bodyStart = target.index + target[0].length;
    const nextStart = episodeNumber < matches.length ? matches[episodeNumber].index ?? text.length : text.length;
    const head = text.slice(0, bodyStart).trimEnd();
    const tail = text.slice(nextStart).trimStart();
    return [head, content.trim(), tail].filter(Boolean).join("\n\n");
}

/** 由结构化状态派生资产 / 集 / 镜头视图，集正文按序号关联大纲与正文 Markdown。 */
export function buildScriptProjectView(state: Pick<CanvasScriptState, "outline" | "script" | "assets" | "storyboard">): ScriptProjectView {
    const outlineBlocks = splitEpisodeBlocks(state.outline);
    const scriptBlocks = splitEpisodeBlocks(state.script);
    const assets = state.assets.map((asset) => ({ ...asset, key: scriptAssetKey(asset.id) }));
    const episodes: ScriptEpisodeView[] = state.storyboard.map((episode) => ({
        id: episode.id,
        key: EPUB(episode.id),
        number: episode.number,
        title: episode.title,
        outline: outlineBlocks[episode.number - 1]?.body || "",
        script: scriptBlocks[episode.number - 1]?.body || "",
    }));
    if (!episodes.length) {
        outlineBlocks.forEach((block, index) => episodes.push({ id: `episode-${index + 1}`, key: EPUB(`episode-${index + 1}`), number: index + 1, title: block.title, outline: block.body, script: scriptBlocks[index]?.body || "" }));
    }
    const shots = state.storyboard.flatMap((episode) => episode.shots.map((shot) => ({ ...shot, key: scriptShotKey(shot.id), episodeId: episode.id, episodeTitle: episode.title })));
    return { episodes, assets, shots };
}

function tagIndexes(prompt: string, tag: string) {
    return [...new Set([...prompt.matchAll(new RegExp(`<${tag}\\s+(\\d+)\\s*>`, "g"))].map((match) => Number(match[1])))].sort((a, b) => a - b);
}

function checkTags(errors: string[], prompt: string, tag: string, count: number) {
    const actual = tagIndexes(prompt, tag);
    const expected = Array.from({ length: count }, (_, index) => index + 1);
    if (actual.join(",") !== expected.join(",")) errors.push(`${tag} 编号应为 ${expected.join(",") || "无"}，实际为 ${actual.join(",") || "无"}`);
}

function checkReferences(errors: string[], label: string, ids: string[], limit: number, allowed: ScriptAssetKind[], assets: ScriptAsset[]) {
    if (ids.length > limit) errors.push(`参考${label} ${ids.length} 个，最多 ${limit} 个`);
    if (new Set(ids).size !== ids.length) errors.push(`参考${label}存在重复条目`);
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const id of ids) {
        const asset = byId.get(id);
        if (!asset) errors.push(`参考${label}不存在：${id}`);
        else if (!allowed.includes(asset.kind)) errors.push(`参考${label}类型不匹配：${asset.name || id}`);
    }
}

/** 校验镜头参数、六段 H3 文本与三类有序引用；媒体是否就绪由画布节点另行检查。 */
export function validateH3Shot(shot: ScriptShot, assets: ScriptAsset[], orientation?: CanvasScriptOptions["orientation"]) {
    const errors: string[] = [];
    if (!shot.title.trim()) errors.push("镜头标题不能为空");
    if (!Number.isInteger(shot.duration) || shot.duration < SCRIPT_SHOT_DURATION.min || shot.duration > SCRIPT_SHOT_DURATION.max) errors.push(`时长必须是 ${SCRIPT_SHOT_DURATION.min}-${SCRIPT_SHOT_DURATION.max} 的整数秒`);
    if (!MINIMAX_H3_SIZES.includes(shot.size)) errors.push(`尺寸必须来自 MiniMax H3 预设：${shot.size || "空"}`);
    else if (orientation) {
        const [w, h] = shot.size.split("x").map(Number);
        const isVertical = h > w;
        if (orientation === "vertical" && !isVertical) errors.push(`竖屏项目尺寸必须为 9:16：${shot.size}`);
        if (orientation === "horizontal" && isVertical) errors.push(`横屏项目尺寸必须为 16:9：${shot.size}`);
    }
    for (const section of SCRIPT_H3_SECTIONS) if (!shot.h3[section]?.trim()) errors.push(`H3 提示词缺少 ${section}`);
    checkReferences(errors, "图片", shot.imageAssetIds, SCRIPT_SHOT_LIMITS.image, SCRIPT_IMAGE_KINDS, assets);
    checkReferences(errors, "视频", shot.videoAssetIds, SCRIPT_SHOT_LIMITS.video, ["video"], assets);
    checkReferences(errors, "音频", shot.audioAssetIds, SCRIPT_SHOT_LIMITS.audio, ["audio"], assets);
    const prompt = formatH3Prompt(shot.h3);
    checkTags(errors, prompt, "Picture", shot.imageAssetIds.length);
    checkTags(errors, prompt, "Video", shot.videoAssetIds.length);
    checkTags(errors, prompt, "Audio", shot.audioAssetIds.length);
    checkTags(errors, prompt, "Subject", shot.imageAssetIds.length);
    return errors;
}

function parseJson(content: string): Record<string, unknown> {
    const text = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("生成结果不是有效的 JSON 对象");
    try {
        const value = JSON.parse(text.slice(start, end + 1));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("生成结果不是 JSON 对象");
        return value as Record<string, unknown>;
    } catch (error) {
        throw new Error(`生成结果 JSON 解析失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
}

function readAssetRefs(value: unknown, allowed: ScriptAssetKind[], assets: ScriptAsset[], label: string) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(`分镜参考${label}必须是数组`);
    return value.map((token) => {
        const raw = String(token).trim();
        const byId = assets.find((asset) => asset.id === raw);
        if (byId) {
            if (!allowed.includes(byId.kind)) throw new Error(`参考${label}类型不匹配：${raw}`);
            return byId.id;
        }
        const normalized = raw.replace("：", ":");
        const parts = normalized.split(":");
        const kindLabel = parts.length > 1 ? parts[0].trim() : "";
        const name = (parts.length > 1 ? parts.slice(1).join(":") : normalized).trim();
        const kind = SCRIPT_KIND_BY_LABEL[kindLabel];
        const found = assets.find((asset) => asset.name === name && allowed.includes(asset.kind) && (!kind || asset.kind === kind));
        if (!found) throw new Error(`分镜引用了不存在的资产：${raw}`);
        return found.id;
    });
}

function normalizeShot(value: unknown, assets: ScriptAsset[], orientation: CanvasScriptOptions["orientation"]): ScriptShot {
    if (!value || typeof value !== "object") throw new Error("分镜镜头必须是对象");
    const raw = value as Record<string, unknown>;
    const h3 = (raw.h3 && typeof raw.h3 === "object" ? raw.h3 : {}) as Record<string, unknown>;
    const shot: ScriptShot = {
        id: nanoid(),
        number: Number(raw.number) || 1,
        title: String(raw.title || "").trim(),
        duration: Number(raw.duration) || 0,
        size: String(raw.size || "").trim() || defaultShotSize(orientation),
        imageAssetIds: readAssetRefs(raw.imageAssets, SCRIPT_IMAGE_KINDS, assets, "图片"),
        videoAssetIds: readAssetRefs(raw.videoAssets, ["video"], assets, "视频"),
        audioAssetIds: readAssetRefs(raw.audioAssets, ["audio"], assets, "音频"),
        h3: SCRIPT_H3_SECTIONS.reduce((acc, section) => ({ ...acc, [section]: String(h3[section] || "").trim() }), {} as ScriptH3Prompt),
    };
    return shot;
}

/** 解析资产阶段 JSON，客户端为每个资产分配稳定 ID。 */
export function parseGeneratedAssets(content: string): ScriptAsset[] {
    const json = parseJson(content);
    const list = json.assets;
    if (!Array.isArray(list) || !list.length) throw new Error("生成结果缺少 assets 数组");
    return list.map((item) => {
        if (!item || typeof item !== "object") throw new Error("资产条目必须是对象");
        const raw = item as Record<string, unknown>;
        const kind = String(raw.kind || "") as ScriptAssetKind;
        const name = String(raw.name || "").trim();
        if (!SCRIPT_ASSET_KINDS.includes(kind)) throw new Error(`资产类型不合法：${kind || "空"}`);
        if (!name) throw new Error("资产名称不能为空");
        return { id: nanoid(), kind, name, description: String(raw.description || "").trim(), prompt: String(raw.prompt || "").trim() };
    });
}

/** 解析分镜阶段单集 JSON，引用按资产 ID 或「类型：名称」解析为稳定 ID。 */
export function parseGeneratedEpisode(content: string, assets: ScriptAsset[], orientation: CanvasScriptOptions["orientation"]) {
    const json = parseJson(content);
    const episode = json.episode;
    if (!episode || typeof episode !== "object") throw new Error("生成结果缺少 episode 对象");
    const raw = episode as Record<string, unknown>;
    if (!Array.isArray(raw.shots) || !raw.shots.length) throw new Error("生成结果缺少 shots 数组");
    return {
        title: String(raw.title || "").trim(),
        shots: raw.shots.map((item, index) => {
            const shot = normalizeShot(item, assets, orientation);
            return { ...shot, number: Number((item as Record<string, unknown>).number) || index + 1 };
        }),
    };
}

/** 解析单镜头重生成 JSON，保留原镜头的 ID 与序号。 */
export function parseGeneratedShot(content: string, current: ScriptShot, assets: ScriptAsset[], orientation: CanvasScriptOptions["orientation"]): ScriptShot {
    const json = parseJson(content);
    const shot = normalizeShot(json.shot, assets, orientation);
    return { ...shot, id: current.id, number: current.number };
}

export function createEmptyScriptState(options?: CanvasScriptOptions): CanvasScriptState {
    return {
        version: 2,
        updatedAt: new Date().toISOString(),
        source: "",
        condensed: "",
        options: options || { episodes: 12, duration: 60, orientation: "vertical" },
        setting: "",
        outline: "",
        script: "",
        assets: [],
        storyboard: [],
    };
}
