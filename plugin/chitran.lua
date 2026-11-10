if vim.g.loaded_chitran then
	return
end

vim.g.loaded_chitran = true

vim.api.nvim_create_user_command("ChitranOpen", function()
	require("Chitran").open()
end, { desc = "Dump current buffer into a browser tab" })
