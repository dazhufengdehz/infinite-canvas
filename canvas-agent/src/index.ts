#!/usr/bin/env node
import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";

const portArgIndex = process.argv.indexOf("--port");
if (process.argv[2] !== "mcp" && portArgIndex !== -1) {
    const port = Number(process.argv[portArgIndex + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error("--port must be an integer between 1 and 65535");
        process.exit(1);
    }
    process.env.PORT = String(port);
}

if (process.argv[2] === "mcp") await startMcpServer();
else startHttpServer();
