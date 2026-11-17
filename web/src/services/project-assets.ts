import { nanoid } from "nanoid";

import { copyMediaFile, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { copyImageFile, resolveImageUrl, uploadImage } from "@/services/image-storage";
import type { Asset, AssetScope } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function resolveAssetMedia(asset: Asset): Promise<Asset> {
    if (asset.kind === "image") {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl);
        return { ...asset, coverUrl: dataUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video") {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        const posterUrl = await resolveMediaUrl(asset.data.posterStorageKey, asset.data.posterUrl || asset.coverUrl);
        return { ...asset, coverUrl: posterUrl || asset.coverUrl, data: { ...asset.data, url, posterUrl } };
    }
    if (asset.kind === "audio") {
        return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    }
    return asset;
}

export async function copyAssetToOwner(asset: Asset, ownerId: string, scope: AssetScope): Promise<Asset> {
    const now = new Date().toISOString();
    const base = {
        ...asset,
        id: nanoid(),
        scope,
        createdAt: now,
        updatedAt: now,
        metadata: { ...asset.metadata, sourceAssetId: asset.id },
    };
    if (asset.kind === "text") return { ...base, kind: "text", data: { ...asset.data } };
    if (asset.kind === "image") {
        const stored = asset.data.storageKey
            ? { ...(await copyImageFile(asset.data.storageKey, ownerId, asset.data.mimeType)), width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType }
            : await uploadImage(asset.data.dataUrl, ownerId);
        return { ...base, kind: "image", coverUrl: stored.url, data: { ...stored, dataUrl: stored.url } };
    }
    if (asset.kind === "video") {
        const stored = asset.data.storageKey
            ? { ...(await copyMediaFile(asset.data.storageKey, "video", ownerId, asset.data.mimeType, asset.data.posterStorageKey)), width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, durationMs: undefined }
            : await uploadMediaFile(asset.data.url, "video", ownerId);
        return { ...base, kind: "video", coverUrl: stored.posterUrl || "", data: { ...asset.data, ...stored, url: stored.url } };
    }
    const stored = asset.data.storageKey
        ? { ...(await copyMediaFile(asset.data.storageKey, "audio", ownerId, asset.data.mimeType)), durationMs: asset.data.durationMs, bytes: asset.data.bytes }
        : await uploadMediaFile(asset.data.url, "audio", ownerId);
    return { ...base, kind: "audio", data: { ...asset.data, ...stored, url: stored.url } };
}

export function assetFromCanvasNode(node: CanvasNodeData, projectId: string, canvasId: string): Asset | null {
    const metadata = node.metadata;
    if (!metadata?.content) return null;
    const base = {
        id: metadata.assetId || nanoid(),
        title: metadata.prompt?.slice(0, 24) || node.title,
        tags: [] as string[],
        source: "Canvas",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: { type: "project", projectId } as const,
        origin: { projectId, canvasId, nodeId: node.id },
        metadata: { source: "canvas", prompt: metadata.prompt },
    };
    if (node.type === CanvasNodeType.Text) return { ...base, kind: "text", coverUrl: "", data: { content: metadata.content } };
    if (node.type === CanvasNodeType.Image) {
        return {
            ...base,
            kind: "image",
            coverUrl: metadata.content,
            data: {
                dataUrl: metadata.storageKey ? "" : metadata.content,
                storageKey: metadata.storageKey,
                width: metadata.naturalWidth || node.width,
                height: metadata.naturalHeight || node.height,
                bytes: metadata.bytes || 0,
                mimeType: metadata.mimeType || "image/png",
            },
        };
    }
    if (node.type === CanvasNodeType.Video) {
        return {
            ...base,
            kind: "video",
            coverUrl: metadata.posterUrl || "",
            data: {
                url: metadata.content,
                storageKey: metadata.storageKey,
                posterUrl: metadata.posterUrl,
                posterStorageKey: metadata.posterStorageKey,
                width: metadata.naturalWidth || node.width,
                height: metadata.naturalHeight || node.height,
                bytes: metadata.bytes || 0,
                mimeType: metadata.mimeType || "video/mp4",
            },
        };
    }
    if (node.type === CanvasNodeType.Audio) {
        return {
            ...base,
            kind: "audio",
            coverUrl: "",
            data: { url: metadata.content, storageKey: metadata.storageKey, bytes: metadata.bytes || 0, mimeType: metadata.mimeType || "audio/mpeg", durationMs: metadata.durationMs },
        };
    }
    return null;
}

export function toAssetDraft(asset: Asset) {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = asset;
    return draft;
}
