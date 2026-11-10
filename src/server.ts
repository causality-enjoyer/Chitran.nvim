import http from "node:http";
import { handleCursorRoute } from "./cursor.js";
import template from "./template.html";

const PORT = Number(process.env.CHITRAN_PORT ?? 8765);
const MAX_BODY = 10 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ID_RE = /^[\w-]+$/;

type Doc = { name: string; text: string; twoWay: boolean };
const docs = new Map<string, Doc>();

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Neovim pushes text ending in "\n"; dropping last one so we don't invent a line.
const toLines = (t: string) => t.replace(/\r?\n$/, "").split("\n");

const renderRaw = (lines: string[]) =>
  lines
    .map(
      (l, i) =>
        `<div class="l" data-line="${i + 1}">${escapeHtml(l) || "&nbsp;"}</div>`,
    )
    .join("");

// Single-pass substitution: inserted content is never re-scanned for placeholders.
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

const page = (id: string, doc: Doc) =>
  fill(template, {
    TITLE: escapeHtml(doc.name),
    BUF: escapeHtml(id),
    TWO_WAY: doc.twoWay ? "1" : "0",
    LAST: String(toLines(doc.text).length),
    BODY: renderRaw(toLines(doc.text)),
  });

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // we accept only requests from our host
    if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) {
      res.writeHead(403).end();
      return;
    }

    // Block cross-site POSTs: a custom header is a good protection as it forces a CORS preflight
    // which the server never grants.
    if (req.method === "POST" && req.headers["x-chitran"] !== "1") {
      res.writeHead(403).end();
      return;
    }

    if (handleCursorRoute(req, res)) return;

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    // Shutdown using custom header
    if (req.method === "POST" && url.pathname === "/shutdown") {
      res.writeHead(204).end(() => process.exit(0));
      return;
    }

    if (req.method === "POST" && parts[0] === "push" && parts[1]) {
      if (!ID_RE.test(parts[1])) {
        res.writeHead(400).end();
        return;
      }

      const text = await readBody(req);
      const name = url.searchParams.get("name") || `buffer ${parts[1]}`;
      const twoWay = url.searchParams.get("two_way") === "1";
      docs.set(parts[1], { name, text, twoWay });
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && parts[0] === "view" && parts[1]) {
      const doc = docs.get(parts[1]);
      if (!doc) {
        res
          .writeHead(404, { "content-type": "text/plain" })
          .end("unknown buffer");
        return;
      }
      res
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(page(parts[1], doc));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  } catch (err) {
    if (res.headersSent) return;
    const tooBig = err instanceof Error && err.message === "body too large";
    res
      .writeHead(tooBig ? 413 : 500, { "content-type": "text/plain" })
      .end(String(err));
  }
});

// Localhost only
server.listen(PORT, "127.0.0.1", () => {
  console.log(`chitran listening on http://127.0.0.1:${PORT}`);
});
