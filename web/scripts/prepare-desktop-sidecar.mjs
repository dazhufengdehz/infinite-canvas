import { copyFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rust = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
const target = /^host: (.+)$/m.exec(rust)?.[1];
if (!target) throw new Error("无法识别 Rust 目标平台");

const binaries = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/binaries");
const extension = process.platform === "win32" ? ".exe" : "";
mkdirSync(binaries, { recursive: true });
copyFileSync(process.execPath, join(binaries, `node-${target}${extension}`));
console.log(`已准备 Node Sidecar：${target}`);
