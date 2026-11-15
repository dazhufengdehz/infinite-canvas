import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopServer } from "../desktop-server.mjs";

function project(id = "project_1") {
    const now = new Date().toISOString();
    return {
        id,
        title: "测试项目",
        createdAt: now,
        updatedAt: now,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: true,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

async function setup(t) {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-desktop-"));
    const server = createDesktopServer({ dataDir });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await rm(dataDir, { recursive: true, force: true });
    });
    return `http://127.0.0.1:${server.address().port}`;
}

function json(method, body) {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

test("项目摘要、revision 和冲突响应符合契约", async (t) => {
    const base = await setup(t);
    const createdResponse = await fetch(`${base}/api/storage/projects`, json("POST", { project: project() }));
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.revision, 1);

    const summaries = await (await fetch(`${base}/api/storage/projects`)).json();
    assert.deepEqual(summaries, [{
        id: created.id,
        title: created.title,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        revision: 1,
        nodeCount: 0,
        connectionCount: 0,
    }]);

    const next = { ...created, title: "已更新", nodes: [{ id: "node-1" }] };
    const savedResponse = await fetch(`${base}/api/storage/projects/${created.id}`, json("PUT", { project: next, baseRevision: 1 }));
    const saved = await savedResponse.json();
    assert.equal(saved.revision, 2);

    const conflict = await fetch(`${base}/api/storage/projects/${created.id}`, json("PUT", { project: saved, baseRevision: 1 }));
    assert.equal(conflict.status, 409);
    assert.equal(typeof (await conflict.json()).error, "string");

    const renamedResponse = await fetch(`${base}/api/storage/projects/${created.id}`, json("PATCH", { title: "重命名" }));
    const renamed = await renamedResponse.json();
    assert.equal(renamed.title, "重命名");
    assert.equal(renamed.revision, 3);
    assert.deepEqual(Object.keys(renamed).sort(), ["connectionCount", "createdAt", "id", "nodeCount", "revision", "title", "updatedAt"]);

    const stored = await (await fetch(`${base}/api/storage/projects/${created.id}`)).json();
    assert.equal(stored.title, "重命名");
    assert.equal(stored.revision, 3);
});

test("媒体 GET/HEAD 支持 200、206 和 416", async (t) => {
    const base = await setup(t);
    const key = "image:assets_media_1";
    const path = `${base}/api/storage/media/${encodeURIComponent(key)}`;
    const uploaded = await fetch(path, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "0123456789" });
    assert.equal(uploaded.status, 200);

    const full = await fetch(path);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-length"), "10");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-type"), "text/plain");
    assert.equal(await full.text(), "0123456789");

    const partial = await fetch(path, { headers: { Range: "bytes=2-5" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(partial.headers.get("content-length"), "4");
    assert.equal(await partial.text(), "2345");

    const head = await fetch(path, { method: "HEAD", headers: { Range: "bytes=2-5" } });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(head.headers.get("content-length"), "4");
    assert.equal(await head.text(), "");

    const invalid = await fetch(path, { headers: { Range: "bytes=20-30" } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */10");
});

test("项目和媒体路径拒绝非法 ID 与路径穿越", async (t) => {
    const base = await setup(t);
    const invalidProject = project("../outside");
    const created = await fetch(`${base}/api/storage/projects`, json("POST", { project: invalidProject }));
    assert.equal(created.status, 400);

    const media = await fetch(`${base}/api/storage/media/${encodeURIComponent("image:assets_bad/key")}`, { method: "PUT", body: "bad" });
    assert.equal(media.status, 400);

    const poster = await fetch(`${base}/api/storage/candidate-posters/${encodeURIComponent("../outside")}`, { method: "PUT", body: "bad" });
    assert.equal(poster.status, 400);

    const missing = await fetch(`${base}/api/storage/not-found`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(typeof (await missing.json()).error, "string");
});

test("媒体复制保留原文件并复制对应 poster", async (t) => {
    const base = await setup(t);
    await fetch(`${base}/api/storage/projects`, json("POST", { project: project("project_1") }));
    const source = "image:p_project_1_source_1";
    const sourcePoster = "poster:p_project_1_source_1";
    const target = "image:p_project_1_target_1";
    const targetPoster = "poster:p_project_1_target_1";
    const mediaUrl = (key) => `${base}/api/storage/media/${encodeURIComponent(key)}`;

    await fetch(mediaUrl(source), { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "copy-me" });
    await fetch(mediaUrl(sourcePoster), { method: "PUT", headers: { "Content-Type": "image/webp" }, body: "poster" });
    const copied = await fetch(`${base}/api/storage/media/copy`, json("POST", { sourceStorageKey: source, targetStorageKey: target, mimeType: "text/plain" }));
    assert.equal(copied.status, 200);

    assert.equal(await (await fetch(mediaUrl(source))).text(), "copy-me");
    const targetResponse = await fetch(mediaUrl(target));
    assert.equal(targetResponse.headers.get("content-type"), "text/plain");
    assert.equal(await targetResponse.text(), "copy-me");
    assert.equal(await (await fetch(mediaUrl(targetPoster))).text(), "poster");
});
