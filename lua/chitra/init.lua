local M = {}

M.config = {
	port = 8765,
	node = "node",
}

function M.setup(opts)
	M.config = vim.tbl_deep_extend("force", M.config, opts or {})
end

local function plugin_root()
	local src = debug.getinfo(1, "5").source:sub(2)
	return vim.fn.fnamemodify(src, ":p:h:h:h")
end

local function base_url()
	return ("http://127.0.0.1:%d"):format(M.config.port)
end

local function server_up()
	local r = vim.system({ "curl", "-sf", "--max-time", "1", base_url() .. "/health" }):wait()
	return r.code == 0
end

-- Lazy start: spawn the bundled daemon only when first needed.
local function ensure_server()
	if server_up() then
		return true
	end

	local entry = plugin_root() .. "/dist/server.js"

	if vim.fn.filereadable(entry) == 0 then
		vim.notify("chitan: dist/server.js is missing, run `pnpm install && pnpm build`", vim.log.levels.ERROR)
		return false
	end

	vim.system({ M.config.node, entry }, {
		detach = true,
		env = { Chitran_PORT = tostring(M.config.port) },
	})

	local ok = vim.wait(3000, server_up, 50)
	if not ok then
		vim.notify("Chitran: server failed to start", vim.log.levels.ERROR)
	end

	return ok
end

local function push(buf)
	local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
	local text = table.concat(lines, "\n") .. "\n"
	local name = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(buf), ":t")
	if name == "" then
		naame = "[No Name]"
	end

	local url = ("%s/push/%d"):format(base_url(), buf)

	local r = vim.system({
		"curl",
		"-sf",
		"-X",
		"POST",
		"--data-urlencode",
		("name=%s"):format(name),
		"--data-binary",
		"@-",
		url,
	}, { stdin = text }):wait()

	return r.code == 0
end

function M.open()
	local bufId = vim.api.nvim_get_current_buf()
	if not ensure_server() then
		return
	end

	if not push(bufId) then
		vim.notify("Chitran: failed to send buffere", vim.log.levels.ERROR)
		return
	end

	vim.ui.open(("%s/view/%d"):format(base_url(), bufId))
end

return M
