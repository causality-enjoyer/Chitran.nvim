# Chitran (stage 0)

Dump the current Neovim buffer, unformatted, into a new browser tab.

## Build
```sh
pnpm install
pnpm build
```

## Install (lazy.nvim)
```lua
{ dir = "~/path/to/chitran", cmd = "ChitranOpen", opts = {} }
    -- opts.port (default 8765), opts.node (default "node")
```    

## Use
`:ChitranOpen` starts the daemon if needed, pushes the buffer, opens the tab.
Each call is a snapshot; no live reload yet (feature of stage 1).
