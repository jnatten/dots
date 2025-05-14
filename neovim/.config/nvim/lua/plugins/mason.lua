return {
	"williamboman/mason.nvim",
	dependencies = {
		"williamboman/mason-lspconfig.nvim",
		"WhoIsSethDaniel/mason-tool-installer.nvim",
	},
	config = function()
		require("mason").setup()

		require("mason-tool-installer").setup({
			ensure_installed = {
				"black",
				"cssls",
				"eslint",
				"eslint_d",
				"html",
				"isort",
				"jsonls",
				"prettier",
				"pylint",
				"pyright",
				"stylua",
				"tailwindcss",
				"terraformls",
				"vtsls",
			},
		})
	end,
}
