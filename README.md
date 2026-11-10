# Chitran

**Pronunciation:** [t͡ʃit̪rəɳ]

A browser Markdown previewer driven from Neovim. The long-term goal is a
well-designed, navigable, foldable reading view for long hierarchical notes,
as a lighter alternative to `markdown-preview.nvim`.

> **Status: stage 0.** Chitran currently dumps the buffer into a browser tab
> as raw text, with two-way cursor sync. There is no Markdown rendering yet.

## What works now

- `:ChitranOpen` sends the current buffer to a local daemon and opens it in
  your default browser.
- The daemon starts lazily the first time you open a buffer.
- One daemon is shared by every Neovim instance.
- **Neovim to browser:** the cursor line is highlighted in the tab, and the
  tab scrolls to follow it (throttled).
- **Browser to Neovim:** `j` / `k` in the tab move the cursor in Neovim.
- Everything stays on localhost.

## Requirements

- Neovim 0.10 or newer (uses `vim.system` and `vim.ui.open`)
- Node.js 22 or newer
- `curl` on your `PATH`
- [pnpm](https://pnpm.io) (v12.18.0) to build
    - NOTE: Older pnpm should work, just go to `~/.local/share/nvim/chitran/` and find package.json and downgrade pnpm.

## Install

Chitran ships a bundled Node server, so you need to build it once.

With [lazy.nvim](https://github.com/folke/lazy.nvim):

```lua
{
  "causality-enjoyer/Chitran.nvim",
  build = "pnpm install && pnpm build",
  config = function()
    require("Chitran").setup({
      -- all optional, these are the defaults
      port = 8765,
      node = "node",
      cursor_sync = true,         -- nvim -> browser
      two_way = true,             -- browser (j/k) -> nvim
      cursor_throttle_ms = 60,
    })
  end,
}
```

Manual build:

```sh
pnpm install
pnpm build   # produces dist/server.js
```

If `dist/server.js` is missing, `:ChitranOpen` will tell you to run the build.

## Commands


| Command | Description |
| --- | --- |
| `:ChitranOpen` | Push the current buffer to the daemon and open it in a browser tab. Run it again to push fresh content and restart sync. |
| `:ChitranStopSync` | Stop cursor sync for the current buffer. |
| `:ChitranClose` | Stop all sync from this Neovim and shut down the daemon. |

## Configuration


| Option | Default | Description |
| --- | --- | --- |
| `port` | `8765` | Port the daemon listens on. Also settable on the daemon with `CHITRAN_PORT`. |
| `node` | `"node"` | Node executable used to start the daemon. |
| `cursor_sync` | `true` | Send the Neovim cursor line to the browser. |
| `two_way` | `true` | Let `j` / `k` in the browser move the Neovim cursor. |
| `cursor_throttle_ms` | `60` | Throttle for cursor updates sent to the browser. |

## How it works

```
Neovim (Lua) --curl--> daemon (Node, HTTP + SSE) --SSE--> browser tab
     ^                                                        |
     +---------------- SSE (nvim-events) <---- POST ----------+
```

- `POST /push/<id>` stores the buffer text. The id is `<nvim pid>-<bufnr>`,
  so separate Neovim instances never collide.
- `GET /view/<id>` serves the page, with one `<div data-line="N">` per source
  line.
- Cursor moves travel as server-sent events. Browser tabs and Neovim use
  separate channels, and Neovim's channel doesn't count as a tab.
- Moves from the browser aren't echoed back to Neovim, which prevents loops.

### Security

- The daemon binds to `127.0.0.1` only.
- Requests with an unexpected `Host` header are rejected.
- Every `POST` must carry the `x-chitran: 1` header. This forces a CORS
  preflight that the server never grants, so other websites can't write to it.
- Buffer text is HTML-escaped before it is rendered.

## Project layout

```
plugin/chitran.lua     user commands
lua/Chitran/init.lua   Neovim side: push, cursor sync, daemon lifecycle
src/server.ts          HTTP server
src/cursor.ts          SSE channels and cursor routing
src/template.html      browser page
build.mjs              esbuild bundle -> dist/server.js
```

## Roadmap

- [x] **Stage 0:** dump the buffer into a browser tab, with cursor sync
- [ ] **Stage 1:** Markdown pipeline, frontmatter, live reload, idle shutdown
- [ ] **Stage 2:** full Neovim plugin (start / stop / toggle, auto-push on save)
- [ ] **Stage 3+:** section tree, design system, navigation, folding, indent guides, focus mode

## Known limitations (stage 0)

- No Markdown rendering. The buffer is shown as plain text.
- Content isn't updated automatically. Run `:ChitranOpen` again to refresh.
- The daemon doesn't exit on idle yet. Use `:ChitranClose`.

## License

[GPL License](./LICENSE)
