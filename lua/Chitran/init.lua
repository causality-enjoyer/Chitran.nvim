local M = {}

M.config = {
	port = 8765,
	node = "node",
	cursor_sync = true, -- nvim -> browser
	two_way = true, -- browser (j/k) -> nvim
	cursor_throttle_ms = 60,
}

local uv = vim.uv or vim.loop
local attached = {} -- bufnr -> { timer, pending, last_line, listener, rx }
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

-- The daemon is shared by every Neovim instance, so bufnr alone collides
local function buf_id(buf)
	return ("%d-%d"):format(vim.fn.getpid(), buf)
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

-- Lazy start: spawn the bundled daemon only when first needed
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
		-- Nobody reads these once Neovim exits; piped stdio could EPIPE theh daemon
		stdout = false,
		stderr = false,
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

	local url = ("%s/push/%s?name=%s&two_way=%d"):format(
		base_url(),
		buf_id(buf),
		url_encode(name),
		M.config.two_way and 1 or 0
	)

	local r = vim.system({
		"curl",
		"-sf",
		"-X",
		"POST",
		"-H",
		"x-chitran: 1",
		"--data-binary",
		"@-",
		url,
	}, { stdin = text }):wait()

	return r.code == 0
end

-- using the devanagari name as header-comment's border because ---- is boring.
-- चित्रण चित्रण चित्रण चित्रण चित्रण
-- nvim -> browser
-- चित्रण चित्रण चित्रण चित्रण चित्रण

local function send_cursor(buf, force)
	local st = attached[buf]
	if not st or not vim.api.nvim_buf_is_valid(buf) then
		return
	end

	-- Only trust the cursor if the current window shows this buffer
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
	local url = ("%s/cursor/%s?line=%d&total=%d"):format(base_url(), buf_id(buf), line, total)
	-- async, fire and forget
	vim.system({ "curl", "-sf", "--max-time", "1", "-X", "POST", "-H", "x-chitran: 1", url })
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

-- चित्रण चित्रण चित्रण चित्रण चित्रण
-- browser -> nvim
-- चित्रण चित्रण चित्रण चित्रण चित्रण

local function apply_remote(buf, line)
	local st = attached[buf]
	if not st or not vim.api.nvim_buf_is_valid(buf) then
		return
	end

	local win = vim.api.nvim_get_current_win()
	if vim.api.nvim_win_get_buf(win) ~= buf then
		win = vim.fn.win_findbuf(buf)[1]
	end
	if not win then
		return
	end

	line = math.max(1, math.min(line, vim.api.nvim_buf_line_count(buf)))
	-- Loop prevention: send_cursor skips unchanged lines, so this move is not echoed back
	st.last_line = line
	pcall(vim.api.nvim_win_set_cursor, win, { line, 0 })
end

-- SSE frames are separated by a blank line; chunks can split anywhere.
local function on_chunk(buf, data)
	local st = attached[buf]
	if not st then
		return
	end
	st.rx = st.rx .. data
	while true do
		local s, e = st.rx:find("\n\n", 1, true)
		if not s then
			break
		end
		local frame = st.rx:sub(1, s - 1)
		st.rx = st.rx:sub(e + 1)

		local payload = frame:match("data:%s*(.+)")
		if payload then
			local ok, msg = pcall(vim.json.decode, payload)
			if ok and type(msg) == "table" and type(msg.line) == "number" then
				apply_remote(buf, msg.line)
			end
		end
	end
end

local function start_listener(buf)
	local st = attached[buf]
	if not st or st.listener or not M.config.two_way then
		return
	end
	st.rx = ""
	st.listener = vim.system({ "curl", "-sN", ("%s/nvim-events/%s"):format(base_url(), buf_id(buf)) }, {
		text = true,
		stdout = function(_, data)
			if data then
				vim.schedule(function()
					on_chunk(buf, data)
				end)
			end
		end,
	}, function()
		-- curl exited (daemon stopped, or we killed it); allow a restart via :ChitranOpen
		vim.schedule(function()
			if attached[buf] then
				attached[buf].listener = nil
			end
		end)
	end)
end

-- चित्रण चित्रण चित्रण चित्रण चित्रण
-- attach / detach
-- चित्रण चित्रण चित्रण चित्रण चित्रण

local function detach(buf)
	local st = attached[buf]
	if not st then
		return
	end
	if st.listener then
		pcall(st.listener.kill, st.listener, 15)
	end
	st.timer:stop()
	st.timer:close()
	attached[buf] = nil
	pcall(vim.api.nvim_clear_autocmds, { group = augroup, buffer = buf })
end

local function attach(buf)
	if attached[buf] then
		start_listener(buf)
		send_cursor(buf, true)
		return
	end
	attached[buf] = { timer = uv.new_timer(), pending = false, last_line = -1, rx = "" }

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

	start_listener(buf)
	send_cursor(buf, true)
end

-- Don't leave curl listeners behind when Neovim exits
vim.api.nvim_create_autocmd("VimLeavePre", {
	group = augroup,
	callback = function()
		for buf in pairs(attached) do
			detach(buf)
		end
	end,
})

function M.open()
	-- vim.ui.open requires Neovim 0.10+
	if vim.fn.has("nvim-0.10") == 0 then
		vim.notify("Chitran: requires Neovim 0.10 or newer", vim.log.levels.ERROR)
		return
	end
	local buf = vim.api.nvim_get_current_buf()
	if not ensure_server() then
		return
	end

	if not push(buf) then
		vim.notify("Chitran: failed to send buffer", vim.log.levels.ERROR)
		return
	end

	if M.config.cursor_sync then
		attach(buf)
	end

	vim.ui.open(("%s/view/%s"):format(base_url(), buf_id(buf)))
end

function M.stop_sync(buf)
	detach(buf or vim.api.nvim_get_current_buf())
end

function M.close()
	-- Tear down this Neovim's sync first (kills curl listeners, timers, autocmds)
	for buf in pairs(attached) do
		detach(buf)
	end

	if not server_up() then
		vim.notify("Chitran: daemon is not running")
		return
	end

	vim.system({
		"curl",
		"-sf",
		"--max-time",
		"1",
		"-X",
		"POST",
		"-H",
		"x-chitran: 1",
		base_url() .. "/shutdown",
	}):wait()

	local down = vim.wait(2000, function()
		return not server_up()
	end, 50)

	if down then
		vim.notify("Chitran: closed")
	else
		vim.notify("Chitran: daemon did not stop", vim.log.levels.WARN)
	end
end

return M
