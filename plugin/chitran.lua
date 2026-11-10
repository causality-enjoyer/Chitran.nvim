if vim.g.loaded_chitran then
	return
end

vim.g.loaded_chitran = true

local cmd = vim.api.nvim_create_user_command

cmd("ChitranOpen", function()
	require("Chitran").open()
end, { desc = "Dump current buffer into a browser tab" })

cmd("ChitranStopSync", function()
	require("Chitran").stop_sync()
end, { desc = "Stop cursor sync for this buffer" })

cmd("ChitranClose", function()
	require("Chitran").close()
end, { desc = "Stop sync and shut down the Chitran daemon" })
