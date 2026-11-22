import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rust = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
const target = /^host: (.+)$/m.exec(rust)?.[1];
if (!target) throw new Error("无法识别 Rust 目标平台");

const scripts = dirname(fileURLToPath(import.meta.url));
const tauri = join(scripts, "../src-tauri");
const binaries = join(tauri, "binaries");
const extension = process.platform === "win32" ? ".exe" : "";
mkdirSync(binaries, { recursive: true });
copyFileSync(process.execPath, join(binaries, `node-${target}${extension}`));
console.log(`已准备 Node Sidecar：${target}`);

const npmCli = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const runNpm = (args, cwd) => {
    const command = process.platform === "win32" ? process.execPath : "npm";
    execFileSync(command, process.platform === "win32" ? [npmCli, ...args] : args, { cwd, stdio: "inherit" });
};
const agent = join(scripts, "../../canvas-agent");
const resources = join(tauri, "resources/canvas-agent");
runNpm(["run", "build"], agent);
// 只重建需要覆盖的部分，保留 node_modules 与依赖哨兵，避免每次打包都全量重装依赖。
mkdirSync(resources, { recursive: true });
rmSync(join(resources, "dist"), { recursive: true, force: true });
cpSync(join(agent, "dist"), join(resources, "dist"), { recursive: true });
for (const file of ["agent-instructions.md", "package.json", "package-lock.json"]) {
    copyFileSync(join(agent, file), join(resources, file));
}

// npm ci 会先清空 node_modules 全量重装，单次可达数分钟。
// 这里用 lock 文件的哈希做哨兵：依赖未变且上次安装完整时跳过重装，只在 lock 变化时执行。
const stampFile = join(resources, ".deps-stamp.json");
const lockHash = createHash("sha256").update(readFileSync(join(resources, "package-lock.json"))).digest("hex");
const previous = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : null;
const installed = existsSync(join(resources, "node_modules"));
if (previous?.lockHash === lockHash && installed) {
    console.log("Canvas Agent 依赖未变化，跳过 npm ci 重装");
} else {
    runNpm(["ci", "--omit=dev", "--no-audit", "--no-fund"], resources);
    writeFileSync(stampFile, JSON.stringify({ lockHash }, null, 2));
}
console.log("已准备 Canvas Agent Sidecar");
