local M = {}

M.config = {
	port = 8765,
	node = "node",
	cursor_sync = true, -- nvim -> browser
	two_way = false, -- reserved: browser -> nvim (not implemented yet)
	cursor_throttle_ms = 60,
}

local uv = vim.uv or vim.loop
local attached = {} -- bufnr -> { timer, pending, last_line }
local augroup = vim.api.nvim_create_augroup("ChitranCursor", { clear = true })

function M.setup(opts)
	M.config = vim.tbl_deep_extend("force", M.config, opts or {})
end

local function plugin_root()
	local src = debug.getinfo(1, "S").source:sub(2)
	return vim.fn.fnamemodify(src, ":p:h:h:h")
end

local function base_url()
	return ("http://127.0.0.1:%d"):format(M.config.port)
end

local function url_encode(s)
	return (s:gsub("[^%w%-%._~]", function(c)
		return ("%%%02X"):format(c:byte())
	end))
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
		vim.notify("Chitran: dist/server.js is missing, run `pnpm install && pnpm build`", vim.log.levels.ERROR)
		return false
	end

	vim.system({ M.config.node, entry }, {
		detach = true,
		env = { CHITRAN_PORT = tostring(M.config.port) },
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
		name = "[No Name]"
	end

	local url = ("%s/push/%d?name=%s"):format(base_url(), buf, url_encode(name))

	local r = vim.system({
		"curl",
		"-sf",
		"-X",
		"POST",
		"--data-binary",
		"@-",
		url,
	}, { stdin = text }):wait()

	return r.code == 0
end

local function send_cursor(buf, force)
	local st = attached[buf]
	if not st or not vim.api.nvim_buf_is_valid(buf) then
		return
	end

	-- Only trust the cursor if the current window shows this buffer.
	local win = vim.api.nvim_get_current_win()
	if vim.api.nvim_win_get_buf(win) ~= buf then
		return
	end

	local line = vim.api.nvim_win_get_cursor(win)[1]
	if not force and line == st.last_line then
		return
	end
	st.last_line = line

	local total = vim.api.nvim_buf_line_count(buf)
	local url = ("%s/cursor/%d?line=%d&total=%d"):format(base_url(), buf, line, total)
	-- async, fire and forget
	vim.system({ "curl", "-sf", "--max-time", "1", "-X", "POST", url })
end

local function schedule_cursor(buf)
	local st = attached[buf]
	if not st or st.pending then
		return
	end
	st.pending = true
	st.timer:start(
		M.config.cursor_throttle_ms,
		0,
		vim.schedule_wrap(function()
			st.pending = false
			send_cursor(buf, false)
		end)
	)
end

local function detach(buf)
	local st = attached[buf]
	if not st then
		return
	end
	st.timer:stop()
	st.timer:close()
	attached[buf] = nil
	pcall(vim.api.nvim_clear_autocmds, { group = augroup, buffer = buf })
end

local function attach(buf)
	if attached[buf] then
		send_cursor(buf, true)
		return
	end
	attached[buf] = { timer = uv.new_timer(), pending = false, last_line = -1 }

	vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
		group = augroup,
		buffer = buf,
		callback = function()
			schedule_cursor(buf)
		end,
	})
	vim.api.nvim_create_autocmd({ "BufWipeout", "BufDelete" }, {
		group = augroup,
		buffer = buf,
		callback = function()
			detach(buf)
		end,
	})
	send_cursor(buf, true)
end

function M.open()
	local bufId = vim.api.nvim_get_current_buf()
	if not ensure_server() then
		return
	end

	if not push(bufId) then
		vim.notify("Chitran: failed to send buffer", vim.log.levels.ERROR)
		return
	end

	if M.config.cursor_sync then
		attach(bufId)
	end

	vim.ui.open(("%s/view/%d"):format(base_url(), bufId))
end

function M.stop_sync(buf)
	detach(buf or vim.api.nvim_get_current_buf())
end

return M
