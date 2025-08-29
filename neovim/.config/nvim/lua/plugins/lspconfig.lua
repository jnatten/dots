return {
	"neovim/nvim-lspconfig",
	dependencies = { "saghen/blink.cmp" },
	opts = {
		servers = {
			cssls = {},
			-- tailwindcss = {},
			html = {},
			jsonls = {},
			terraformls = {},
			eslint = {},
			ruff = {},
			basedpyright = {
				settings = {
					basedpyright = {
						disableOrganizeImports = true,
						analysis = {
							ignore = { "*" },
						},
					},
				},
			},
			rust_analyzer = {},
			vtsls = {
				root_markers = { "tsconfig.json", "jsconfig.json", ".git" },
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
		-- TODO: finn en kulere måte å gjøre dette på bro
		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("lsp_attach_disable_ruff_hover", { clear = true }),
			callback = function(args)
				local client = vim.lsp.get_client_by_id(args.data.client_id)
				if client == nil then
					return
				end
				if client.name == "ruff" then
					-- Disable hover in favor of Pyright
					client.server_capabilities.hoverProvider = false
				end
			end,
			desc = "LSP: Disable hover capability from Ruff",
		})

		for server, config in pairs(opts.servers) do
			vim.lsp.enable(server)
			vim.lsp.config(server, config)
		end
	end,
}
