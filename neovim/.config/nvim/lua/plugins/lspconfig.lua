return {
	"neovim/nvim-lspconfig",
	dependencies = { "saghen/blink.cmp" },
	opts = {
		servers = {
			cssls = {},
			tailwindcss = {},
			html = {},
			jsonls = {},
			terraformls = {},
			eslint = {},
			pyright = {},
			vtsls = {
				filetypes = {
					"javascript",
					"javascriptreact",
					"javascript.jsx",
					"typescript",
					"typescriptreact",
					"typescript.tsx",
					"vue",
				},
				settings = {
					typescript = {
						preferences = {
							importModuleSpecifier = "relative",
						},
					},
					javascript = {
						preferences = {
							importModuleSpecifier = "relative",
						},
					},
				},
			},
		},
	},
	config = function(_, opts)
		local lspconfig = require("lspconfig")
		for server, config in pairs(opts.servers) do
			config.capabilities = require("blink.cmp").get_lsp_capabilities(config.capabilities)
			lspconfig[server].setup(config)
		end
	end,
}
