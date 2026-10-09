import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compilePreset, catalog } from "./core.mjs";
const port = Number(process.env.PORT ?? 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError("Invalid PORT");
const page = fileURLToPath(new URL("./public/index.html", import.meta.url));
function reply(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'"
  });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}
async function readRequest(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) {
      const e = new TypeError("Body over 16 KiB"); e.status = 413; throw e;
    }
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/") {
        return reply(res, 200, await readFile(page, "utf8"), "text/html; charset=utf-8");
      }
      if (req.method === "GET" && path === "/api/catalog") return reply(res, 200, { presets: catalog() });
      if (req.method === "POST" && path === "/api/build") return reply(res, 200, await compilePreset(await readRequest(req)));
      return reply(res, 404, { error: "Unknown path" });
    } catch (e) {
      const code = e.status === 413 ? 413 : e instanceof TypeError || e instanceof SyntaxError ? 400 : 500;
      return reply(res, code, { error: code === 500 ? "SDK compilation failed; inspect local server" : e.message });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, "127.0.0.1", () => process.stdout.write("Open http://127.0.0.1:" + port + "\n"));
}
