import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Explicit routes only: never expose the repository, environment files or dependencies.
const routes = new Map([
  ["/browser-tests.html", ["./browser-tests.html", "text/html"]],
  ["/browser-tests.js", ["./browser-tests.js", "text/javascript"]],
  ["/src/content/contentScript.js", ["../../src/content/contentScript.js", "text/javascript"]],
  ["/src/content/inputTracker.js", ["../../src/content/inputTracker.js", "text/javascript"]],
  ["/src/content/observer.js", ["../../src/content/observer.js", "text/javascript"]],
  ["/src/content/sentenceDetector.js", ["../../src/content/sentenceDetector.js", "text/javascript"]],
  ["/src/content/suggestionSession.js", ["../../src/content/suggestionSession.js", "text/javascript"]],
  ["/src/content/suggestionUI.js", ["../../src/content/suggestionUI.js", "text/javascript"]],
  ["/src/content/editors/index.js", ["../../src/content/editors/index.js", "text/javascript"]],
  ["/src/content/editors/contenteditable.js", ["../../src/content/editors/contenteditable.js", "text/javascript"]],

  ["/", ["./index.html", "text/html"]],
  ["/index.html", ["./index.html", "text/html"]],
  ["/playground.css", ["./playground.css", "text/css"]],
  ["/playground.js", ["./playground.js", "text/javascript"]],
  ["/diagnostics.js", ["./diagnostics.js", "text/javascript"]],
  ["/src/content/editors/nativeControl.js", ["../../src/content/editors/nativeControl.js", "text/javascript"]],
  ["/src/shared/suggestionRequest.js", ["../../src/shared/suggestionRequest.js", "text/javascript"]],
]);

export function createPlaygroundServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || "")) {
      res.writeHead(403); res.end("Loopback hosts only"); return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); }
    catch { res.writeHead(400); res.end("Invalid URL"); return; }
    const route = routes.get(pathname);
    if (!route) { res.writeHead(404); res.end("Not found"); return; }
    try {
      const body = await readFile(new URL(route[0], import.meta.url));
      res.writeHead(200, { "Content-Type": route[1] + "; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch { res.writeHead(500); res.end("Fixture unavailable"); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const server = createPlaygroundServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log("Editor playground: http://127.0.0.1:" + port));
}
