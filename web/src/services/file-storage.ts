import localforage from "localforage";

import { hasStorageServer, putStorageBlob, storageMediaUrl } from "@/services/api/storage";
import { scopedStorageKey } from "@/services/project-storage";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; posterUrl?: string; posterStorageKey?: string };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file", ownerId = "assets"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = scopedStorageKey(prefix, ownerId);
    const url = await setMediaBlob(storageKey, blob);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
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

export async function getMediaBlob(storageKey: string) {
    if (await hasStorageServer()) {
        const response = await fetch(storageMediaUrl(storageKey));
        return response.ok ? response.blob() : null;
    }
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
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

export async function deleteStoredMedia(keys: Iterable<string>) {
    const uniqueKeys = Array.from(new Set(keys));
    for (const key of uniqueKeys) {
        const url = objectUrls.get(key);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(key);
    }
    if (await hasStorageServer()) return;
    await Promise.all(uniqueKeys.map((key) => store.removeItem(key)));
}

export function releaseMediaObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

export async function cleanupUnusedMedia(usedData: unknown) {
    if (await hasStorageServer()) return;
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => store.removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    if ("posterStorageKey" in value && typeof value.posterStorageKey === "string") keys.add(value.posterStorageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => {
            const result = { width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined };
            video.pause();
            video.removeAttribute("src");
            video.load();
            resolve(result);
        };
        video.preload = "metadata";
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
            audio.removeAttribute("src");
            audio.load();
            resolve({ durationMs });
        };
        const timer = setTimeout(done, 3000);
        audio.onloadedmetadata = () => {
            clearTimeout(timer);
            done();
        };
        audio.onerror = () => {
            clearTimeout(timer);
            done();
        };
        audio.src = url;
    });
}
