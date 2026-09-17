import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const root = join(process.cwd(), "dist");
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    const relative = normalize(requested === "/" ? "sidebar.html" : requested.replace(/^\/+/, ""));
    if (relative.startsWith("..")) throw new Error("Invalid path");
    const file = join(root, relative);
    response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(4173, "127.0.0.1", resolve));
try {
  await import("./smoke-ui.mjs");
  await import("./smoke-content.mjs");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
