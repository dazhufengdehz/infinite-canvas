import { nanoid } from "nanoid";

import { t } from "@/i18n";
import { getDslMiddleSize, MINIMAX_H3_SIZES } from "@/services/api/models/video-minimax-h3-omni";
import type {
    ProductionChapter,
    ProductionEpisode,
    ProductionOptions,
    ProductionState,
    ScriptAsset,
    ScriptAssetKind,
    ScriptH3Prompt,
    ScriptShot,
} from "@/types/canvas";

export const PRODUCTION_ASSET_KINDS: ScriptAssetKind[] = ["character", "scene", "prop", "video", "audio"];
export const PRODUCTION_IMAGE_KINDS: ScriptAssetKind[] = ["character", "scene", "prop"];
export const PRODUCTION_ASSET_KIND_LABEL: Record<ScriptAssetKind, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
    video: "参考视频",
    audio: "参考音频",
};
export const PRODUCTION_H3_SECTIONS = [
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
] as const;

export const PRODUCTION_SHOT_LIMITS = { image: 9, video: 3, audio: 3 };
export const PRODUCTION_SHOT_DURATION = { min: 1, max: 15 };

const KIND_BY_LABEL: Record<string, ScriptAssetKind> = { 角色: "character", 场景: "scene", 道具: "prop", 视频: "video", 音频: "audio" };

export const productionAssetKey = (id: string) => `asset:${id}`;
export const productionShotKey = (id: string) => `shot:${id}`;
export const productionEpisodeKey = (id: string) => `episode:${id}`;
export const PRODUCTION_SETTING_KEY = "setting";
export const PRODUCTION_OUTLINE_KEY = "outline";

export function emptyH3Prompt(): ScriptH3Prompt {
    return {
        subject_definitions: "",
        summary: "",
        retention_analysis: "",
        detailed_description: "",
        overall_soundscape: "",
        non_diegetic_music: "",
    };
}

export function formatH3Prompt(h3: ScriptH3Prompt) {
    return PRODUCTION_H3_SECTIONS.map((section) => `${section}: ${h3[section]?.trim() || ""}`).join("\n");
}

/** 资产显示名：类型 + 名称 + 短 id，用于区分同名资产，引用始终以 id 保存。 */
export function assetLabel(asset: ScriptAsset) {
    return `${t(`canvas.production.kind.${asset.kind}`)} · ${asset.name || t("canvas.production.untitled")} · ${asset.id.slice(0, 4)}`;
}

/** 资产清单序列化给模型：保持稳定中文提示词，不随界面语言变化。 */
export function formatAssetList(assets: ScriptAsset[]) {
    return assets
        .map((asset) => `${PRODUCTION_ASSET_KIND_LABEL[asset.kind]}：${asset.name}｜id=${asset.id}｜${asset.description}｜参考提示词：${asset.prompt}`)
        .join("\n");
}

export function defaultShotSize(orientation?: ProductionOptions["orientation"]) {
    return getDslMiddleSize(MINIMAX_H3_SIZES, orientation === "horizontal" ? "16:9" : "9:16");
}

export function createProductionAsset(kind: ScriptAssetKind): ScriptAsset {
    return { id: nanoid(), kind, name: "", description: "", prompt: "" };
}

export function createProductionShot(orientation?: ProductionOptions["orientation"]): ScriptShot {
    return {
        id: nanoid(),
        number: 1,
        title: "",
        duration: 5,
        size: defaultShotSize(orientation),
        imageAssetIds: [],
        videoAssetIds: [],
        audioAssetIds: [],
        h3: emptyH3Prompt(),
    };
}

export function createProductionEpisode(number: number, title = ""): ProductionEpisode {
    return { id: nanoid(), number, title: title || `第${number}集`, synopsis: "", script: "", shots: [] };
}

export function defaultProductionOptions(): ProductionOptions {
    return { episodes: 12, duration: 60, genre: "", audience: "", orientation: "vertical" };
}

export function createEmptyProduction(canvasId = "", options?: Partial<ProductionOptions>): ProductionState {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        canvasId,
        options: { ...defaultProductionOptions(), ...options },
        source: { text: "", condensed: "", chapters: [] },
        setting: "",
        assets: [],
        episodes: [],
    };
}

/** 按「第X章 / 第X节 / 第X回」切分小说原文，供选择改编范围。 */
export function splitNovelChapters(text: string): ProductionChapter[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const matches = [...trimmed.matchAll(/^\s*(第[0-9一二三四五六七八九十百千零两]+[章节回卷][^\n]*)$/gm)];
    if (!matches.length) return [{ title: "全文", content: trimmed }];
    const chapters: ProductionChapter[] = [];
    const intro = trimmed.slice(0, matches[0].index ?? 0).trim();
    if (intro) chapters.push({ title: "序章", content: intro });
    matches.forEach((match, index) => {
        chapters.push({
            title: match[1].trim(),
            content: trimmed.slice(match.index ?? 0, matches[index + 1]?.index ?? trimmed.length).trim(),
        });
    });
    return chapters;
}

/** 解析大纲 Markdown 为「集标题 + 梗概」，按标题顺序稳定编号。 */
export function parseOutlineMarkdown(text: string): { title: string; synopsis: string }[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const matches = [...trimmed.matchAll(/^#{1,4}\s*(第[^\n]*集[^\n]*)$/gm)];
    if (!matches.length) return [{ title: "第1集", synopsis: trimmed }];
    return matches.map((match, index, all) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = index + 1 < all.length ? all[index + 1].index ?? trimmed.length : trimmed.length;
        return { title: match[1].trim(), synopsis: trimmed.slice(start, end).trim() };
    });
}

/** 把结构化分集序列化为模型可读的大纲文本。 */
export function serializeOutline(episodes: ProductionEpisode[]) {
    return episodes.map((episode) => `### 第${episode.number}集 ${episode.title.replace(/^第\s*\d+\s*集\s*/, "")}\n${episode.synopsis}`.trim()).join("\n\n");
}

export function allShots(production: Pick<ProductionState, "episodes">) {
    return production.episodes.flatMap((episode) => episode.shots.map((shot) => ({ ...shot, episodeId: episode.id, episodeTitle: episode.title, episodeNumber: episode.number })));
}

export type ProductionShotView = ScriptShot & { key: string; episodeId: string; episodeTitle: string; episodeNumber: number };

export function listShots(production: Pick<ProductionState, "episodes">): ProductionShotView[] {
    return allShots(production).map((shot) => ({ ...shot, key: productionShotKey(shot.id) }));
}

export function assetUsages(production: Pick<ProductionState, "episodes">, assetId: string) {
    return listShots(production).filter((shot) => [...shot.imageAssetIds, ...shot.videoAssetIds, ...shot.audioAssetIds].includes(assetId));
}


function tagIndexes(prompt: string, tag: string) {
    return [...new Set([...prompt.matchAll(new RegExp(`<${tag}\\s+(\\d+)\\s*>`, "g"))].map((match) => Number(match[1])))].sort((a, b) => a - b);
}

function checkTags(errors: string[], prompt: string, tag: string, count: number) {
    const actual = tagIndexes(prompt, tag);
    const expected = Array.from({ length: count }, (_, index) => index + 1);
    if (actual.join(",") !== expected.join(",")) {
        errors.push(t("canvas.production.error.tagOrder", { tag, expected: expected.join(",") || t("canvas.production.error.tagNone"), actual: actual.join(",") || t("canvas.production.error.tagNone") }));
    }
}

function checkReferences(errors: string[], label: string, ids: string[], limit: number, allowed: ScriptAssetKind[], assets: ScriptAsset[]) {
    if (ids.length > limit) errors.push(t("canvas.production.error.refLimit", { label, count: ids.length, limit }));
    if (new Set(ids).size !== ids.length) errors.push(t("canvas.production.error.refDuplicate", { label }));
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const id of ids) {
        const asset = byId.get(id);
        if (!asset) errors.push(t("canvas.production.error.refNotFound", { label, id }));
        else if (!allowed.includes(asset.kind)) errors.push(t("canvas.production.error.refKindWrong", { label, name: asset.name || id }));
    }
}

/** 校验镜头参数、六段 H3 文本与三类有序引用；媒体是否就绪由画布节点另行检查。 */
export function validateShot(shot: ScriptShot, assets: ScriptAsset[], orientation?: ProductionOptions["orientation"]) {
    const errors: string[] = [];
    if (!shot.title.trim()) errors.push(t("canvas.production.error.titleEmpty"));
    if (!Number.isInteger(shot.duration) || shot.duration < PRODUCTION_SHOT_DURATION.min || shot.duration > PRODUCTION_SHOT_DURATION.max) {
        errors.push(t("canvas.production.error.durationInvalid", { min: PRODUCTION_SHOT_DURATION.min, max: PRODUCTION_SHOT_DURATION.max }));
    }
    if (!MINIMAX_H3_SIZES.includes(shot.size)) errors.push(t("canvas.production.error.sizeInvalid", { size: shot.size || t("canvas.production.error.sizeEmpty") }));
    else if (orientation) {
        const [w, h] = shot.size.split("x").map(Number);
        const isVertical = h > w;
        if (orientation === "vertical" && !isVertical) errors.push(t("canvas.production.error.sizeVertical", { size: shot.size }));
        if (orientation === "horizontal" && isVertical) errors.push(t("canvas.production.error.sizeHorizontal", { size: shot.size }));
    }
    for (const section of PRODUCTION_H3_SECTIONS) if (!shot.h3[section]?.trim()) errors.push(t("canvas.production.error.h3Missing", { section }));
    checkReferences(errors, t("canvas.production.referenceLabel.image"), shot.imageAssetIds, PRODUCTION_SHOT_LIMITS.image, PRODUCTION_IMAGE_KINDS, assets);
    checkReferences(errors, t("canvas.production.referenceLabel.video"), shot.videoAssetIds, PRODUCTION_SHOT_LIMITS.video, ["video"], assets);
    checkReferences(errors, t("canvas.production.referenceLabel.audio"), shot.audioAssetIds, PRODUCTION_SHOT_LIMITS.audio, ["audio"], assets);
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
    if (start < 0 || end <= start) throw new Error(t("canvas.production.error.jsonNotObject"));
    try {
        const value = JSON.parse(text.slice(start, end + 1));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("canvas.production.error.jsonNotObjectRaw"));
        return value as Record<string, unknown>;
    } catch (error) {
        throw new Error(t("canvas.production.error.jsonParseFailed", { reason: error instanceof Error ? error.message : t("canvas.production.error.unknownReason") }));
    }
}

function readAssetRefs(value: unknown, allowed: ScriptAssetKind[], assets: ScriptAsset[], label: string) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(t("canvas.production.error.refMustBeArray", { label }));
    return value.map((token) => {
        const raw = String(token).trim();
        const byId = assets.find((asset) => asset.id === raw);
        if (byId) {
            if (!allowed.includes(byId.kind)) throw new Error(t("canvas.production.error.refKindMismatch", { label, value: raw }));
            return byId.id;
        }
        const normalized = raw.replace("：", ":");
        const parts = normalized.split(":");
        const kindLabel = parts.length > 1 ? parts[0].trim() : "";
        const name = (parts.length > 1 ? parts.slice(1).join(":") : normalized).trim();
        const kind = KIND_BY_LABEL[kindLabel];
        const found = assets.find((asset) => asset.name === name && allowed.includes(asset.kind) && (!kind || asset.kind === kind));
        if (!found) throw new Error(t("canvas.production.error.refAssetMissing", { value: raw }));
        return found.id;
    });
}

function normalizeShot(value: unknown, assets: ScriptAsset[], orientation: ProductionOptions["orientation"]): ScriptShot {
    if (!value || typeof value !== "object") throw new Error(t("canvas.production.error.shotMustBeObject"));
    const raw = value as Record<string, unknown>;
    const h3 = (raw.h3 && typeof raw.h3 === "object" ? raw.h3 : {}) as Record<string, unknown>;
    return {
        id: nanoid(),
        number: Number(raw.number) || 1,
        title: String(raw.title || "").trim(),
        duration: Number(raw.duration) || 0,
        size: String(raw.size || "").trim() || defaultShotSize(orientation),
        imageAssetIds: readAssetRefs(raw.imageAssets, PRODUCTION_IMAGE_KINDS, assets, t("canvas.production.referenceLabel.image")),
        videoAssetIds: readAssetRefs(raw.videoAssets, ["video"], assets, t("canvas.production.referenceLabel.video")),
        audioAssetIds: readAssetRefs(raw.audioAssets, ["audio"], assets, t("canvas.production.referenceLabel.audio")),
        h3: PRODUCTION_H3_SECTIONS.reduce((acc, section) => ({ ...acc, [section]: String(h3[section] || "").trim() }), {} as ScriptH3Prompt),
    };
}

/** 解析资产阶段 JSON，客户端为每个资产分配稳定 ID。 */
export function parseGeneratedAssets(content: string): ScriptAsset[] {
    const json = parseJson(content);
    const list = json.assets;
    if (!Array.isArray(list) || !list.length) throw new Error(t("canvas.production.error.assetsMissing"));
    return list.map((item) => {
        if (!item || typeof item !== "object") throw new Error(t("canvas.production.error.assetMustBeObject"));
        const raw = item as Record<string, unknown>;
        const kind = String(raw.kind || "") as ScriptAssetKind;
        const name = String(raw.name || "").trim();
        if (!PRODUCTION_ASSET_KINDS.includes(kind)) throw new Error(t("canvas.production.error.assetKindInvalid", { kind: kind || t("canvas.production.error.assetKindEmpty") }));
        if (!name) throw new Error(t("canvas.production.error.assetNameEmpty"));
        return { id: nanoid(), kind, name, description: String(raw.description || "").trim(), prompt: String(raw.prompt || "").trim() };
    });
}

/** 解析分镜阶段单集 JSON，引用按资产 ID 或「类型：名称」解析为稳定 ID。 */
export function parseGeneratedEpisode(content: string, assets: ScriptAsset[], orientation: ProductionOptions["orientation"]) {
    const json = parseJson(content);
    const episode = json.episode;
    if (!episode || typeof episode !== "object") throw new Error(t("canvas.production.error.episodeMissing"));
    const raw = episode as Record<string, unknown>;
    if (!Array.isArray(raw.shots) || !raw.shots.length) throw new Error(t("canvas.production.error.shotsMissing"));
    return {
        title: String(raw.title || "").trim(),
        shots: raw.shots.map((item, index) => {
            const shot = normalizeShot(item, assets, orientation);
            return { ...shot, number: Number((item as Record<string, unknown>).number) || index + 1 };
        }),
    };
}

/** 解析单镜头重生成 JSON，保留原镜头 ID 与序号。 */
export function parseGeneratedShot(content: string, current: ScriptShot, assets: ScriptAsset[], orientation: ProductionOptions["orientation"]): ScriptShot {
    const json = parseJson(content);
    const shot = normalizeShot(json.shot, assets, orientation);
    return { ...shot, id: current.id, number: current.number };
}

/** 规范化从存储读取的生产数据，缺字段时给出安全默认值。 */
export function normalizeProduction(raw: unknown, canvasId: string): ProductionState {
    if (!raw || typeof raw !== "object") return createEmptyProduction(canvasId);
    const value = raw as Partial<ProductionState>;
    if (value.version !== 1) throw new Error(t("canvas.production.error.versionIncompatible"));
    const base = createEmptyProduction(canvasId);
    return {
        ...base,
        ...value,
        version: 1,
        canvasId: value.canvasId || canvasId,
        options: { ...base.options, ...value.options },
        source: { ...base.source, ...value.source },
        setting: value.setting || "",
        assets: Array.isArray(value.assets) ? value.assets : [],
        episodes: Array.isArray(value.episodes)
            ? value.episodes.map((episode) => ({
                  ...createProductionEpisode(episode.number || 1, episode.title || ""),
                  ...episode,
                  shots: Array.isArray(episode.shots) ? episode.shots : [],
              }))
            : [],
    };
}
