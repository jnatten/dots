return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = { "saghen/blink.cmp" },
	config = function()
		local servers = {}
		for file in vim.fs.dir(vim.fn.stdpath("config") .. "/after/lsp") do
			servers[#servers + 1] = file:match("^(.*)%.lua$")
		end
		vim.lsp.enable(servers)
	end,
}
