import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentLogWriter } from "../utils/agent-runtime.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

export const TRAE_THREAD_ID = "trae-session";
const TRAE_INSTALL_HINT = "未检测到 Trae CLI 2.0，请先安装并登录，确保 traecli 位于 PATH";

type TraeTurnInput = {
    prompt: string;
    cwd: string;
    sourceClientId: string;
    attachments?: AgentAttachment[];
};

type ActiveTraeTurn = {
    child: ChildProcessWithoutNullStreams | null;
    tempDir: string;
    threadId: string;
    turnId: string;
    sourceClientId: string;
    stopping: boolean;
    finished: boolean;
};

let activeTurn: ActiveTraeTurn | null = null;

export class TraeTurnError extends Error {
    constructor(message: string, readonly statusCode = 500) {
        super(message);
        this.name = "TraeTurnError";
    }
}

/** 检测 PATH 中的 Trae CLI，并返回当前任务状态。 */
export async function checkTraeStatus() {
    const available = await new Promise<{ available: boolean; version?: string; error?: string }>((resolve) => {
        const child = spawn(traeCommand(), ["--version"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (result: { available: boolean; version?: string; error?: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            child.kill();
            finish({ available: false, error: "Trae CLI 状态检测超时" });
        }, 5000);
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        child.once("error", () => finish({ available: false, error: TRAE_INSTALL_HINT }));
        child.once("close", (code) => {
            const version = stdout.trim().split(/\r?\n/)[0] || "";
            finish(code === 0 ? { available: true, version } : { available: false, error: stderr.trim() || TRAE_INSTALL_HINT });
        });
    });
    return {
        ok: true,
        ...available,
        busy: Boolean(activeTurn),
        threadId: activeTurn?.threadId || TRAE_THREAD_ID,
        turnId: activeTurn?.turnId || "",
    };
}

/** 启动一次独立的 Trae CLI 非交互任务。 */
export async function startTraeTurn(input: TraeTurnInput, emit: AgentEmit) {
    if (activeTurn) throw new TraeTurnError("Trae 正在运行，请等待当前任务结束或先停止任务", 409);
    const turn: ActiveTraeTurn = {
        child: null,
        tempDir: "",
        threadId: TRAE_THREAD_ID,
        turnId: `trae-turn-${crypto.randomUUID()}`,
        sourceClientId: input.sourceClientId,
        stopping: false,
        finished: false,
    };
    activeTurn = turn;
    try {
        turn.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "infinite-canvas-trae-"));
        const images = await writeAttachmentFiles(input.attachments || [], turn.tempDir);
        const outputFile = path.join(turn.tempDir, "last-message.md");
        const args = [
            "exec",
            "--json",
            "--ephemeral",
            "--skip-git-repo-check",
            "--cd", input.cwd,
            "--sandbox", "workspace-write",
            "--ask-for-approval", "never",
            "--output-last-message", outputFile,
            ...(images.length ? ["--image", images.join(",")] : []),
            "-",
        ];
        const child = spawn(traeCommand(), args, { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
        turn.child = child;
        await waitForSpawn(child);
        const scope = { agent: "trae", threadId: turn.threadId, turnId: turn.turnId, sourceClientId: turn.sourceClientId };
        let stderrText = "";
        const stdout = createAgentLogWriter((text) => {
            const line = text.trim();
            if (!line) return;
            try {
                const event = JSON.parse(line) as unknown;
                emit("agent_log", { ...scope, text: JSON.stringify(event) });
            } catch {
                emit("agent_log", { ...scope, text: line });
            }
        });
        const stderr = createAgentLogWriter((text) => {
            const line = text.trim();
            if (!line) return;
            stderrText = `${stderrText}\n${line}`.trim().slice(-4000);
            emit("agent_log", { ...scope, text: line });
        });
        child.stdout.on("data", (chunk) => stdout.write(chunk.toString()));
        child.stderr.on("data", (chunk) => stderr.write(chunk.toString()));
        child.stdin.on("error", (error) => logger.warn("Trae CLI stdin failed", { error: error.message, turnId: turn.turnId }));
        child.once("error", (error) => void finishTraeTurn(turn, emit, error));
        child.once("close", (code) => {
            stdout.flush();
            stderr.flush();
            void finishTraeTurn(turn, emit, code === 0 || turn.stopping ? undefined : new Error(stderrText || `Trae CLI 已退出（${code ?? "未知退出码"}）`), outputFile, code);
        });
        child.stdin.end(input.prompt);
        emit("agent_event", { ...scope, type: "turn.started" });
        logger.info("Trae turn started", { threadId: turn.threadId, turnId: turn.turnId, attachmentCount: images.length });
        return { threadId: turn.threadId, turnId: turn.turnId };
    } catch (error) {
        activeTurn = null;
        if (turn.tempDir) await fs.rm(turn.tempDir, { recursive: true, force: true }).catch(() => undefined);
        const message = errorMessage(error);
        throw new TraeTurnError(message.includes("ENOENT") ? TRAE_INSTALL_HINT : message);
    }
}

/** 停止当前 Trae 子进程。 */
export function interruptTraeTurn(threadId?: string) {
    const turn = activeTurn;
    if (!turn?.child || turn.finished || (threadId && threadId !== turn.threadId)) return false;
    turn.stopping = true;
    turn.child.kill();
    return true;
}

async function finishTraeTurn(turn: ActiveTraeTurn, emit: AgentEmit, error?: Error, outputFile = "", code: number | null = null) {
    if (turn.finished) return;
    turn.finished = true;
    const scope = { agent: "trae", threadId: turn.threadId, turnId: turn.turnId, sourceClientId: turn.sourceClientId };
    try {
        if (!error && !turn.stopping) {
            const text = outputFile ? (await fs.readFile(outputFile, "utf8").catch(() => "")).trim() : "";
            if (!text) throw new Error("Trae CLI 没有返回最终答复");
            emit("agent_event", {
                ...scope,
                type: "item.completed",
                item: { id: `trae-message-${crypto.randomUUID()}`, type: "agent_message", text },
            });
        }
    } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
    }
    if (error && !turn.stopping) {
        logger.error("Trae turn failed", { turnId: turn.turnId, error: error.message });
        emit("agent_error", { ...scope, message: error.message });
    }
    emit("agent_event", { ...scope, type: "turn.completed", status: error ? "failed" : turn.stopping ? "cancelled" : "completed" });
    emit("agent_done", { ...scope, code: error || turn.stopping ? 1 : code || 0 });
    activeTurn = null;
    if (turn.tempDir) await fs.rm(turn.tempDir, { recursive: true, force: true }).catch(() => undefined);
    logger.info("Trae turn finished", { threadId: turn.threadId, turnId: turn.turnId, stopped: turn.stopping });
}

function waitForSpawn(child: ChildProcessWithoutNullStreams) {
    return new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
            child.off("error", onError);
            resolve();
        };
        const onError = (error: Error) => {
            child.off("spawn", onSpawn);
            reject(error);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
    });
}

function traeCommand() {
    return process.platform === "win32" ? "traecli.cmd" : "traecli";
}

async function writeAttachmentFiles(attachments: AgentAttachment[], directory: string) {
    return await Promise.all(attachments.filter((item) => item.dataUrl?.startsWith("data:image/")).map(async (item, index) => {
        const [, meta = "", data = ""] = item.dataUrl?.match(/^data:([^;]+);base64,(.+)$/) || [];
        if (!data) throw new Error(`图片附件无效：${item.name || "未命名图片"}`);
        const file = path.join(directory, `image-${index + 1}.${imageExt(meta || item.type)}`);
        await fs.writeFile(file, Buffer.from(data, "base64"));
        return file;
    }));
}

function imageExt(type = "") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
}
