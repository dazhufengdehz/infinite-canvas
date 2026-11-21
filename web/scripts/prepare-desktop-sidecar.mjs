import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
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
rmSync(resources, { recursive: true, force: true });
mkdirSync(resources, { recursive: true });
cpSync(join(agent, "dist"), join(resources, "dist"), { recursive: true });
for (const file of ["agent-instructions.md", "package.json", "package-lock.json"]) {
    copyFileSync(join(agent, file), join(resources, file));
}
runNpm(["ci", "--omit=dev", "--no-audit", "--no-fund"], resources);
console.log("已准备 Canvas Agent Sidecar");
