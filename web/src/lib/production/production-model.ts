import { nanoid } from "nanoid";

import { t } from "@/i18n";
import { getDslMiddleSize, MINIMAX_H3_SIZES } from "@/services/api/models/video-minimax-h3-omni";
import type {
    ProductionBatchConfig,
    ProductionChapter,
    ProductionEpisode,
    ProductionOptions,
    ProductionState,
    ScriptAsset,
    ScriptAssetKind,
    ScriptAssetVariant,
    ScriptH3Prompt,
    ScriptShot,
    ShotBlocking,
    ShotConsistency,
} from "@/types/canvas";

export const PRODUCTION_ASSET_KINDS: ScriptAssetKind[] = ["character", "scene", "prop"];
export const PRODUCTION_ASSET_KIND_LABEL: Record<ScriptAssetKind, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
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

/** 每类资产向 H3 提示词贡献的字段：资产负责「这个参考对象是什么、必须保留什么」。 */
export const ASSET_H3_FIELDS: Record<ScriptAssetKind, (keyof ScriptH3Prompt)[]> = {
    character: ["subject_definitions", "retention_analysis", "summary", "overall_soundscape"],
    scene: ["subject_definitions", "retention_analysis", "overall_soundscape"],
    prop: ["subject_definitions", "retention_analysis"],
};

const KIND_BY_LABEL: Record<string, ScriptAssetKind> = { 角色: "character", 场景: "scene", 道具: "prop" };

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

/** 形态显示名：资产名 · 形态名。 */
export function variantLabel(asset: ScriptAsset, variant: ScriptAssetVariant) {
    return `${asset.name || t("canvas.production.untitled")} · ${variant.name || t("canvas.production.untitled")}`;
}

/** 资产的全部形态；没有形态时返回一个继承资产的默认形态。 */
export function assetVariants(asset: ScriptAsset): ScriptAssetVariant[] {
    return asset.variants?.length ? asset.variants : [{ id: asset.id, name: "", description: "", prompt: "", h3: {} }];
}

/** 形态的有效图像生成提示词：形态为空时继承资产自身的。 */
export function variantPrompt(asset: ScriptAsset, variant: ScriptAssetVariant) {
    return variant.prompt?.trim() || asset.prompt;
}

/** 形态的有效 H3 字段：形态自己的优先，缺省时回落到资产级基线。 */
export function variantH3(asset: ScriptAsset, variant: ScriptAssetVariant): Partial<ScriptH3Prompt> {
    const merged: Partial<ScriptH3Prompt> = { ...asset.h3 };
    for (const field of PRODUCTION_H3_SECTIONS) {
        const text = variant.h3?.[field]?.trim();
        if (text) merged[field] = text;
    }
    return merged;
}

/** 资产清单序列化给模型：保持稳定中文提示词，不随界面语言变化。 */
export function formatAssetList(assets: ScriptAsset[]) {
    return assets
        .map((asset) => {
            const variantText = assetVariants(asset)
                .map((variant) => {
                    const merged = variantH3(asset, variant);
                    const h3 = PRODUCTION_H3_SECTIONS.map((field) => (merged[field]?.trim() ? `${field}：${merged[field]!.trim()}` : "")).filter(Boolean).join("｜");
                    return `形态「${variant.name || "默认"}」：${variant.description || "同基础形象"}｜提示词：${variantPrompt(asset, variant)}${h3 ? `｜H3参考字段：${h3}` : ""}`;
                })
                .join("；");
            return `${PRODUCTION_ASSET_KIND_LABEL[asset.kind]}：${asset.name}｜id=${asset.id}｜${asset.description}｜基础提示词：${asset.prompt}｜形态：${variantText}`;
        })
        .join("\n");
}

export function defaultShotSize(orientation?: ProductionOptions["orientation"]) {
    return getDslMiddleSize(MINIMAX_H3_SIZES, orientation === "horizontal" ? "16:9" : "9:16");
}

export function createProductionAsset(kind: ScriptAssetKind): ScriptAsset {
    return { id: nanoid(), kind, name: "", description: "", prompt: "", variants: [], h3: {} };
}

/** 新建一个资产形态，继承资产的名称与提示词作为起点。 */
export function createAssetVariant(asset: ScriptAsset): ScriptAssetVariant {
    return { id: nanoid(), name: "", description: "", prompt: asset.prompt || "", h3: {} };
}

export function createProductionShot(orientation?: ProductionOptions["orientation"]): ScriptShot {
    return {
        id: nanoid(),
        number: 1,
        title: "",
        duration: 5,
        size: defaultShotSize(orientation),
        imageVariantIds: [],
        videoAssetIds: [],
        audioAssetIds: [],
        h3: emptyH3Prompt(),
    };
}

export function createProductionEpisode(number: number, title = "", synopsis = ""): ProductionEpisode {
    return { id: nanoid(), number, title: title || `第${number}集`, synopsis, script: "", shots: [] };
}

export function defaultProductionOptions(): ProductionOptions {
    return { episodes: 12, duration: 60, genre: "", audience: "", orientation: "vertical", subtitle: true, bgm: true };
}

export function defaultProductionBatch(): ProductionBatchConfig {
    return { assetWorkflowId: "", shotWorkflowId: "", assetSize: "", shotSeconds: 0, seed: -1 };
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
        batch: defaultProductionBatch(),
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

export function assetUsages(production: Pick<ProductionState, "episodes" | "assets">, assetId: string) {
    const variantIds = new Set(variantIdsOfAsset(production.assets, assetId));
    return listShots(production).filter((shot) => shot.imageVariantIds.some((id) => variantIds.has(id)));
}

/** 某个资产下所有形态的 ID。 */
export function variantIdsOfAsset(assets: ScriptAsset[], assetId: string) {
    const asset = assets.find((item) => item.id === assetId);
    return asset ? assetVariants(asset).map((variant) => variant.id) : [];
}

/** 按形态 ID 找到所属资产与形态本身。 */
export function findVariant(assets: ScriptAsset[], variantId: string) {
    for (const asset of assets) {
        const variant = assetVariants(asset).find((item) => item.id === variantId);
        if (variant) return { asset, variant };
    }
    return null;
}

/** 资产在某字段上的贡献前缀：主体定义用 <Subject N> is <Picture N>，其余只带编号标签。 */
function assetContributionPrefix(field: keyof ScriptH3Prompt, bucket: "image" | "video" | "audio", index: number) {
    const n = index + 1;
    if (field === "subject_definitions" && bucket === "image") return `<Subject ${n}> is <Picture ${n}>`;
    if (bucket === "image") return `<Subject ${n}>`;
    return `<${bucket === "video" ? "Video" : "Audio"} ${n}>`;
}

/** 该资产在镜头文本中的覆盖标记：命中即表示镜头已经写过这个参考对象。 */
function assetCoverageTags(bucket: "image" | "video" | "audio", index: number) {
    const n = index + 1;
    if (bucket === "image") return [`<Subject ${n}>`, `<Picture ${n}>`];
    return [`<${bucket === "video" ? "Video" : "Audio"} ${n}>`];
}

/**
 * 按连线顺序把已连接形态的 H3 贡献合并进镜头六段。
 * 镜头优先：镜头文本里已经写过该参考对象的字段保持原样，
 * 资产只补充镜头尚未覆盖的部分，因此每个参考对象都会保留自己的绑定。
 */
export function mergeAssetH3(shot: ScriptShot, assets: ScriptAsset[], context?: { previous?: ScriptShot; options?: Pick<ProductionOptions, "subtitle" | "bgm"> }): ScriptH3Prompt {
    const buckets = [
        { bucket: "image" as const, ids: shot.imageVariantIds },
        { bucket: "video" as const, ids: shot.videoAssetIds },
        { bucket: "audio" as const, ids: shot.audioAssetIds },
    ];

    // 每个字段记录「镜头已覆盖的参考对象」与「形态待补充的条目」。
    const blocks = new Map<keyof ScriptH3Prompt, { prefix: string; text: string; tags: string[] }[]>();
    for (const { bucket, ids } of buckets) {
        ids.forEach((id, index) => {
            const found = findVariant(assets, id);
            if (!found) return;
            const h3 = variantH3(found.asset, found.variant);
            const tags = assetCoverageTags(bucket, index);
            for (const field of ASSET_H3_FIELDS[found.asset.kind]) {
                const text = h3[field]?.trim();
                if (!text) continue;
                const list = blocks.get(field) ?? [];
                list.push({ prefix: assetContributionPrefix(field, bucket, index), text, tags });
                blocks.set(field, list);
            }
        });
    }

    const merged = { ...shot.h3 };
    for (const field of PRODUCTION_H3_SECTIONS) {
        const own = shot.h3[field]?.trim() ?? "";
        const extra = blocks.get(field) ?? [];
        // 镜头已经写过的参考对象不再重复追加，只补齐镜头未覆盖的部分。
        const missing = extra.filter((item) => !item.tags.some((tag) => own.includes(tag)));
        merged[field] = [own, ...missing.map((item) => `${item.prefix}: ${item.text}`)].filter(Boolean).join("\n\n");
    }
    // 参考视频与参考音频是用户上传的节点，没有 H3 文本可合并，但仍要保留编号绑定。
    const tagBlocks: { field: keyof ScriptH3Prompt; tag: string }[] = [];
    shot.videoAssetIds.forEach((_, index) => tagBlocks.push({ field: "detailed_description", tag: `<Video ${index + 1}>` }));
    shot.audioAssetIds.forEach((_, index) => tagBlocks.push({ field: "overall_soundscape", tag: `<Audio ${index + 1}>` }));
    for (const { field, tag } of tagBlocks) {
        const own = merged[field] ?? "";
        if (own.includes(tag)) continue;
        merged[field] = [own, tag].filter(Boolean).join("\n\n");
    }
    // 站位锁定：连续镜头把上一镜头的位置声明注入本镜头，保证跨镜头空间关系连续。
    const blocking = shot.blocking?.continuous ? deriveShotBlocking(shot, context?.previous) : shot.blocking;
    if (blocking) {
        const indexById = new Map(shot.imageVariantIds.map((id, index) => [id, index + 1]));
        const lines: string[] = [];
        for (const [id, position] of Object.entries(blocking.positions)) {
            const number = indexById.get(id);
            if (!number) continue;
            lines.push(`<Subject ${number}> 站位：${position}`);
        }
        if (lines.length) {
            const own = merged.subject_definitions?.trim() ?? "";
            merged.subject_definitions = [own, ...lines].filter(Boolean).join("\n");
            const retention = merged.retention_analysis?.trim() ?? "";
            const keep = lines.map((line) => `${line.replace(" 站位：", " 保持与上一镜头一致的站位：")}`).join("\n");
            merged.retention_analysis = [retention, keep].filter(Boolean).join("\n");
        }
    }
    // 一致性备注写入保留段，确保跨镜头需要保留的特征进入提示词。
    const notes = shot.consistency?.notes?.trim();
    if (notes) {
        const retention = merged.retention_analysis?.trim() ?? "";
        merged.retention_analysis = [retention, notes].filter(Boolean).join("\n");
    }
    return context?.options ? applyMediaOptions(merged, context.options) : merged;
}


/** 镜头用于生成的最终 H3 文本：镜头内容优先，资产贡献补齐空字段。 */
export function resolveShotH3(shot: ScriptShot, assets: ScriptAsset[], context?: { previous?: ScriptShot; options?: Pick<ProductionOptions, "subtitle" | "bgm"> }) {
    return mergeAssetH3(shot, assets, context);
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

/** 校验镜头参数、六段 H3 文本与有序引用；媒体是否就绪由画布节点另行检查。 */
export function validateShot(
    shot: ScriptShot,
    assets: ScriptAsset[],
    orientation?: ProductionOptions["orientation"],
    options?: Pick<ProductionOptions, "subtitle" | "bgm">,
) {
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
    const merged = mergeAssetH3(shot, assets, { options });
    for (const section of PRODUCTION_H3_SECTIONS) {
        // 关闭 BGM 时配乐段不再必填。
        if (section === "non_diegetic_music" && options && !options.bgm) continue;
        if (!merged[section]?.trim()) errors.push(t("canvas.production.error.h3Missing", { section }));
    }
    // 图片引用必须指向真实存在的形态。
    if (shot.imageVariantIds.length > PRODUCTION_SHOT_LIMITS.image) errors.push(t("canvas.production.error.refLimit", { label: t("canvas.production.referenceLabel.image"), count: shot.imageVariantIds.length, limit: PRODUCTION_SHOT_LIMITS.image }));
    if (new Set(shot.imageVariantIds).size !== shot.imageVariantIds.length) errors.push(t("canvas.production.error.refDuplicate", { label: t("canvas.production.referenceLabel.image") }));
    for (const id of shot.imageVariantIds) {
        if (!findVariant(assets, id)) errors.push(t("canvas.production.error.refNotFound", { label: t("canvas.production.referenceLabel.image"), id }));
    }
    if (shot.videoAssetIds.length > PRODUCTION_SHOT_LIMITS.video) errors.push(t("canvas.production.error.refLimit", { label: t("canvas.production.referenceLabel.video"), count: shot.videoAssetIds.length, limit: PRODUCTION_SHOT_LIMITS.video }));
    if (shot.audioAssetIds.length > PRODUCTION_SHOT_LIMITS.audio) errors.push(t("canvas.production.error.refLimit", { label: t("canvas.production.referenceLabel.audio"), count: shot.audioAssetIds.length, limit: PRODUCTION_SHOT_LIMITS.audio }));
    const prompt = formatH3Prompt(merged);
    checkTags(errors, prompt, "Picture", shot.imageVariantIds.length);
    checkTags(errors, prompt, "Subject", shot.imageVariantIds.length);
    checkTags(errors, prompt, "Video", shot.videoAssetIds.length);
    checkTags(errors, prompt, "Audio", shot.audioAssetIds.length);
    return errors;
}

/**
 * 跨镜头一致性检查：只提示不阻断。
 * 覆盖三类问题：站位冲突、继承资产缺失、同一资产形态漂移。
 */
export function validateShotConsistency(shot: ScriptShot, shots: ScriptShot[], assets: ScriptAsset[]) {
    const warnings: string[] = [];
    const index = shots.findIndex((item) => item.id === shot.id);
    const previous = index > 0 ? shots[index - 1] : undefined;

    // 站位冲突：相邻镜头同一角色站位描述完全不同且未声明连续。
    if (previous?.blocking && shot.blocking && !shot.blocking.continuous) {
        for (const [id, position] of Object.entries(shot.blocking.positions)) {
            const before = previous.blocking.positions[id];
            if (before && before !== position) {
                warnings.push(t("canvas.production.warning.blockingConflict", { position: before, next: position }));
                break;
            }
        }
    }

    // 继承资产缺失：声明要与上一镜头保持一致的资产没有出现在本镜头引用里。
    for (const id of shot.consistency?.carryOverAssetIds || []) {
        if (!shot.imageVariantIds.includes(id)) {
            const found = findVariant(assets, id);
            warnings.push(t("canvas.production.warning.carryOverMissing", { name: found?.asset.name || id.slice(0, 6) }));
        }
    }

    // 形态漂移：同一资产在相邻镜头被引用了不同形态。
    if (previous) {
        const assetOf = (variantId: string) => assets.find((asset) => assetVariants(asset).some((variant) => variant.id === variantId));
        for (const id of shot.imageVariantIds) {
            const asset = assetOf(id);
            if (!asset) continue;
            const before = previous.imageVariantIds.find((variantId) => assetOf(variantId)?.id === asset.id);
            if (before && before !== id) {
                warnings.push(t("canvas.production.warning.variantDrift", { name: asset.name }));
                break;
            }
        }
    }
    return warnings;
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

function readAssetRefs(value: unknown, assets: ScriptAsset[], label: string): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(t("canvas.production.error.refMustBeArray", { label }));
    return value.map((token) => {
        const raw = String(token).trim();
        // 直接给形态 ID。
        if (findVariant(assets, raw)) return raw;
        const normalized = raw.replace("：", ":");
        // 「资产id:形态名」或「资产id:形态id」：先按资产 ID 定位资产，再匹配形态。
        const colonIndex = normalized.indexOf(":");
        if (colonIndex > 0) {
            const owner = assets.find((asset) => asset.id === normalized.slice(0, colonIndex).trim());
            if (owner) {
                const variantToken = normalized.slice(colonIndex + 1).trim();
                const variants = assetVariants(owner);
                const matched = variants.find((variant) => variant.id === variantToken || variant.name === variantToken);
                return (matched || variants[0]).id;
            }
        }
        // 给资产 ID：解析到该资产的第一个形态。
        const byAsset = assets.find((asset) => asset.id === raw);
        if (byAsset) {
            const first = assetVariants(byAsset)[0];
            if (!first) throw new Error(t("canvas.production.error.refAssetMissing", { value: raw }));
            return first.id;
        }
        // 「类型：名称」或纯名称：解析到同名资产的第一个形态。
        const parts = normalized.split(":");
        const kindLabel = parts.length > 1 ? parts[0].trim() : "";
        const name = (parts.length > 1 ? parts.slice(1).join(":") : normalized).trim();
        const kind = KIND_BY_LABEL[kindLabel];
        const found = assets.find((asset) => asset.name === name && (!kind || asset.kind === kind));
        if (!found) throw new Error(t("canvas.production.error.refAssetMissing", { value: raw }));
        const first = assetVariants(found)[0];
        if (!first) throw new Error(t("canvas.production.error.refAssetMissing", { value: raw }));
        return first.id;
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
        imageVariantIds: readAssetRefs(raw.imageAssets, assets, t("canvas.production.referenceLabel.image")),
        videoAssetIds: [],
        audioAssetIds: [],
        h3: PRODUCTION_H3_SECTIONS.reduce((acc, section) => ({ ...acc, [section]: String(h3[section] || "").trim() }), {} as ScriptH3Prompt),
        blocking: parseGeneratedBlocking(raw.blocking, assets),
        consistency: parseGeneratedConsistency(raw.consistency, assets),
    };
}

/** 解析站位声明：characterIds 只接受真实存在的角色资产，positions 保留文本。 */
export function parseGeneratedBlocking(value: unknown, assets: ScriptAsset[]): ShotBlocking | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const positions: Record<string, string> = {};
    const rawPositions = raw.positions && typeof raw.positions === "object" ? (raw.positions as Record<string, unknown>) : {};
    for (const [key, text] of Object.entries(rawPositions)) {
        const description = String(text || "").trim();
        if (!description) continue;
        // 形态 ID 优先；只有资产 ID 时回落到该资产的第一个形态。
        const variant = findVariant(assets, key);
        const asset = variant ? null : assets.find((item) => item.id === key);
        if (!variant && !asset) continue;
        const variantId = variant ? variant.variant.id : assetVariants(asset!)[0].id;
        positions[variantId] = description;
    }
    const characterIds = Object.keys(positions);
    if (!characterIds.length) return undefined;
    return { characterIds, positions, continuous: Boolean(raw.continuous) };
}

/** 解析一致性声明：只保留真实存在的资产 ID。 */
export function parseGeneratedConsistency(value: unknown, assets: ScriptAsset[]): ShotConsistency | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const carryOverAssetIds: string[] = [];
    const list = Array.isArray(raw.carryOverAssetIds) ? raw.carryOverAssetIds : [];
    for (const token of list) {
        const id = String(token || "").trim();
        if (!id) continue;
        const found = findVariant(assets, id);
        if (!found) continue;
        carryOverAssetIds.push(found.variant.id);
    }
    const notes = String(raw.notes || "").trim();
    if (!carryOverAssetIds.length && !notes) return undefined;
    return { carryOverAssetIds, notes };
}

/** 按上一镜头继承站位：连续镜头自动带上上一镜头的位置描述。 */
export function deriveShotBlocking(shot: ScriptShot, previous?: ScriptShot): ShotBlocking | undefined {
    if (!previous?.blocking) return shot.blocking;
    if (!shot.blocking?.continuous) return shot.blocking;
    const positions = { ...previous.blocking.positions, ...(shot.blocking?.positions || {}) };
    const characterIds = Array.from(new Set([...previous.blocking.characterIds, ...(shot.blocking?.characterIds || [])]));
    return { characterIds, positions, continuous: true };
}

/** 字幕与 BGM 开关收口：关闭时清空台词片段与配乐段。 */
export function applyMediaOptions(h3: ScriptH3Prompt, options: Pick<ProductionOptions, "subtitle" | "bgm">): ScriptH3Prompt {
    const next = { ...h3 };
    if (!options.bgm) next.non_diegetic_music = "";
    if (!options.subtitle) {
        next.detailed_description = stripDialogue(next.detailed_description);
        next.overall_soundscape = stripDialogue(next.overall_soundscape);
        next.summary = stripDialogue(next.summary);
    }
    return next;
}

/** 去掉 H3 文本里的台词片段（<d>...</d>），用于关闭字幕的场景。 */
function stripDialogue(text: string) {
    return text.replace(/<d>[\s\S]*?<\/d>/g, "").trim();
}

/** 解析资产阶段 JSON，客户端为每个资产与形态分配稳定 ID。 */
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
        const asset: ScriptAsset = {
            id: nanoid(),
            kind,
            name,
            description: String(raw.description || "").trim(),
            prompt: String(raw.prompt || "").trim(),
            variants: [],
            h3: parseAssetH3(raw.h3),
        };
        asset.variants = parseGeneratedVariants(raw.variants, asset);
        // 资产没有形态时，用资产自身作为默认形态。
        if (!asset.variants.length) {
            asset.variants.push({ id: nanoid(), name: "", description: "", prompt: asset.prompt, h3: {} });
        }
        return asset;
    });
}

/** 解析资产的形态列表：形态缺省 H3 时继承资产级字段。 */
function parseGeneratedVariants(value: unknown, asset: ScriptAsset): ScriptAssetVariant[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
            id: nanoid(),
            name: String(raw.name || "").trim(),
            description: String(raw.description || "").trim(),
            prompt: String(raw.prompt || "").trim() || asset.prompt,
            h3: parseAssetH3(raw.h3),
        };
    });
}

/** 解析资产的 H3 参考字段模板：只保留该资产类型允许贡献的字段。 */
function parseAssetH3(value: unknown): Partial<ScriptH3Prompt> {
    if (!value || typeof value !== "object") return {};
    const raw = value as Record<string, unknown>;
    const result: Partial<ScriptH3Prompt> = {};
    for (const field of PRODUCTION_H3_SECTIONS) {
        const text = String(raw[field] || "").trim();
        if (text) result[field] = text;
    }
    return result;
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
        batch: { ...base.batch, ...(value.batch || {}) },
        assets: Array.isArray(value.assets)
            ? value.assets.map((asset) => ({
                  ...asset,
                  h3: asset.h3 && typeof asset.h3 === "object" ? asset.h3 : {},
                  variants: Array.isArray(asset.variants)
                      ? asset.variants.map((variant) => ({ ...variant, h3: variant.h3 && typeof variant.h3 === "object" ? variant.h3 : {} }))
                      : [],
              }))
            : [],
        episodes: Array.isArray(value.episodes)
            ? value.episodes.map((episode) => ({
                  ...createProductionEpisode(episode.number || 1, episode.title || ""),
                  ...episode,
                  shots: Array.isArray(episode.shots)
                      ? episode.shots.map((shot) => ({
                            ...shot,
                            blocking: shot.blocking && typeof shot.blocking === "object" ? shot.blocking : undefined,
                            consistency: shot.consistency && typeof shot.consistency === "object" ? shot.consistency : undefined,
                        }))
                      : [],
              }))
            : [],
    };
}
