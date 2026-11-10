import type { IncomingMessage, ServerResponse } from "node:http";

type Cursor = { line: number; total: number };

// Browser tabs (count toward idle shutdown later).
const clients = new Map<string, Set<ServerResponse>>();
// Neovim listeners (deliberately not counted as tabs).
const nvimClients = new Map<string, Set<ServerResponse>>();
const lastCursor = new Map<string, Cursor>();

export function connectedTabs(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

function sse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function openStream(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Map<string, Set<ServerResponse>>,
  id: string,
  catchUp?: Cursor,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 1000\n\n");

  let set = pool.get(id);
  if (!set) pool.set(id, (set = new Set()));
  set.add(res);

  if (catchUp) sse(res, "cursor", catchUp);

  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    set!.delete(res);
  });
}

function parseLine(url: URL): number | null {
  const line = Number(url.searchParams.get("line"));
  return Number.isFinite(line) && line >= 1 ? Math.floor(line) : null;
}

/** Returns true if the request was handled. Call from the router first.
 * Host and x-chitran checks happen in `server.ts` before this runs
 * Ids are "<nvim pid>-<bufnr>".
 */
export function handleCursorRoute(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const m = url.pathname.match(
    /^\/(events|cursor|browser-cursor|nvim-events)\/([\w-]+)$/,
  );
  if (!m) return false;
  const [, kind, id] = m;

  // browser tab subscribes (late joiners catch up)
  if (kind === "events" && req.method === "GET") {
    openStream(req, res, clients, id, lastCursor.get(id));
    return true;
  }

  // neovim subscribes (no catch-up, so connecting never moves the cursor)
  if (kind === "nvim-events" && req.method === "GET") {
    openStream(req, res, nvimClients, id);
    return true;
  }

  // neovim -> browsers
  if (kind === "cursor" && req.method === "POST") {
    const line = parseLine(url);
    if (line === null) {
      res.writeHead(400).end();
      return true;
    }
    const cur: Cursor = {
      line,
      total: Number(url.searchParams.get("total")) || 0,
    };
    lastCursor.set(id, cur);
    for (const c of clients.get(id) ?? []) sse(c, "cursor", cur);
    res.writeHead(204).end();
    return true;
  }

  // browser -> neovim (not echoed back to browsers)
  if (kind === "browser-cursor" && req.method === "POST") {
    const line = parseLine(url);
    if (line === null) {
      res.writeHead(400).end();
      return true;
    }
    lastCursor.set(id, { line, total: lastCursor.get(id)?.total ?? 0 });
    for (const c of nvimClients.get(id) ?? []) sse(c, "cursor", { line });
    res.writeHead(204).end();
    return true;
  }

  return false;
}
