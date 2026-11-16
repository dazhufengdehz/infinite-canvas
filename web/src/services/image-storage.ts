import localforage from "localforage";

import i18n from "@/i18n";
import { readImageMeta } from "@/lib/image-utils";
import { hasStorageServer, putStorageBlob, storageMediaUrl, storageRequest } from "@/services/api/storage";
import { scopedStorageKey } from "@/services/project-storage";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob, ownerId = "assets"): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = scopedStorageKey("image", ownerId);
    const url = await setImageBlob(storageKey, blob);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function adoptGeneratedImage(source: { dataUrl: string; sourceToken?: string }, ownerId = "assets"): Promise<UploadedImage> {
    if (!/^https?:\/\//i.test(source.dataUrl) || !(await hasStorageServer())) return uploadImage(source.dataUrl, ownerId);
    const storageKey = scopedStorageKey("image", ownerId);
    await storageRequest("/media/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetStorageKey: storageKey, sourceUrl: source.dataUrl, token: source.sourceToken }),
    });
    const url = storageMediaUrl(storageKey);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: 0, mimeType: meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (await hasStorageServer()) return storageMediaUrl(storageKey);
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (await hasStorageServer()) {
        const response = await fetch(storageMediaUrl(storageKey));
        return response.ok ? response.blob() : null;
    }
    return store.getItem<Blob>(storageKey);
}

export async function copyImageFile(sourceStorageKey: string, ownerId: string, mimeType: string) {
    const storageKey = scopedStorageKey("image", ownerId);
    if (await hasStorageServer()) {
        await storageRequest("/media/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceStorageKey, targetStorageKey: storageKey, mimeType }),
        });
    } else {
        const blob = await getImageBlob(sourceStorageKey);
        if (!blob) throw new Error("图片文件不存在");
        await setImageBlob(storageKey, blob);
    }
    return { url: await resolveImageUrl(storageKey), storageKey };
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (await hasStorageServer()) {
        await putStorageBlob(`/media/${encodeURIComponent(storageKey)}`, blob);
        return storageMediaUrl(storageKey);
    }
    await store.setItem(storageKey, blob);
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    const response = await fetch(url);
    if (!response.ok) throw new Error(i18n.t("common.imageReadFailed"));
    return blobToDataUrl(await response.blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    const uniqueKeys = Array.from(new Set(keys));
    for (const key of uniqueKeys) {
        const url = objectUrls.get(key);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(key);
    }
    if (await hasStorageServer()) return;
    await Promise.all(uniqueKeys.map((key) => store.removeItem(key)));
}

export function releaseImageObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

export async function cleanupUnusedImages(usedData: unknown) {
    if (await hasStorageServer()) return;
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
