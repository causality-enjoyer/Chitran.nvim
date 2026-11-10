import type { IncomingMessage, ServerResponse } from "node:http";

type Cursor = { line: number; total: number };

const clients = new Map<string, Set<ServerResponse>>();
const lastCursor = new Map<string, Cursor>();

// will be used when multiple tabs are connected; placeholder for now
export function connectedTabs(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

function sse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Returns true if the request was handled. **Called from the router first** */
export function handleCursorRoute(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const m = url.pathname.match(/^\/(events|cursor)\/(\d+)$/);
  if (!m) return false;
  const [, kind, id] = m;

  if (kind === "events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");

    let set = clients.get(id);
    if (!set) clients.set(id, (set = new Set()));
    set.add(res);

    const last = lastCursor.get(id);
    if (last) sse(res, "cursor", last); // late joiner catches up

    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      set!.delete(res);
    });
    return true;
  }

  if (kind === "cursor" && req.method === "POST") {
    const line = Number(url.searchParams.get("line"));
    const total = Number(url.searchParams.get("total"));
    if (!Number.isFinite(line) || line < 1) {
      res.writeHead(400).end();
      return true;
    }
    const cur: Cursor = { line, total };
    lastCursor.set(id, cur);
    for (const c of clients.get(id) ?? []) sse(c, "cursor", cur);
    res.writeHead(204).end();
    return true;
  }

  return false;
}
