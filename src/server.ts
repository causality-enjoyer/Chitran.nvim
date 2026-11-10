import http from "node:http";
import { handleCursorRoute } from "./cursor.js";

const PORT = Number(process.env.CHITRAN_PORT ?? 8765);
const MAX_BODY = 10 * 1024 * 1024;

// id -> { name, text }
const docs = new Map<string, { name: string; text: string }>();

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const renderRaw = (text: string) =>
  text
    .split("\n")
    .map(
      (l, i) =>
        `<div class="l" data-line="${i + 1}">${escapeHtml(l) || "&nbsp;"}</div>`,
    )
    .join("");

const page = (id: string, name: string, text: string) => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(name)}</title>
<style>
  body { font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
  .l.cur { background: rgba(255, 200, 0, .18); box-shadow: -3px 0 0 #fc0; }
</style>
</head>
<body>
${renderRaw(text)}
<script>
  const BUF = ${JSON.stringify(id)};
  let current = null;
  const es = new EventSource("/events/" + BUF);
  es.addEventListener("cursor", (e) => {
    const { line } = JSON.parse(e.data);
    let el = null;
    for (let n = line; n >= 1 && !el; n--) el = document.querySelector('[data-line="' + n + '"]');
    if (!el) return;
    current?.classList.remove("cur");
    el.classList.add("cur");
    current = el;
    const r = el.getBoundingClientRect();
    const h = window.innerHeight;
    if (r.top < h * 0.25 || r.bottom > h * 0.75) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
</script>
</body>
</html>
`;

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
    if (handleCursorRoute(req, res)) return;

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    if (req.method === "POST" && parts[0] === "push" && parts[1]) {
      const text = await readBody(req);
      const name = url.searchParams.get("name") || `buffer ${parts[1]}`;
      docs.set(parts[1], { name, text });
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
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(page(parts[1], doc.name, doc.text));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(err));
  }
});

// Localhost only
server.listen(PORT, "127.0.0.1", () => {
  console.log(`chitran listening on http://127.0.0.1:${PORT}`);
});
