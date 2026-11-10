import http from "node:http";

const PORT = Number(process.env.CHITRAN_PORT ?? 8765);
const MAX_BODY = 10 * 1024 * 1024;

// id -> { name, text}
const docs = new Map<string, { name: string; text: string }>();

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = (name: string, text: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(name)}</title>
  </head>

  <body>
    <pre style="white-space: pre-wrap; word-break: break-word">
			${escapeHtml(text)}
		</pre>
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
        .end(page(doc.name, doc.text));
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
