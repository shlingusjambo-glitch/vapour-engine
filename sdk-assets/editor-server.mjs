import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] ?? "5174");
const root = path.resolve(process.argv[3] ?? ".");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Editor port must be from 1 to 65535.");

createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    let file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Path escapes editor root.");
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    response.setHeader("Content-Type", contentType(file));
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Vapour Editor: http://127.0.0.1:${port}/`));

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".json") || file.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
