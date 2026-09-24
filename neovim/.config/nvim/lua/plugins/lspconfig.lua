local function root(markers)
	return function(bufnr, on_dir)
		local dir = vim.fs.root(bufnr, markers)
		if dir then
			on_dir(dir)
		end
	end
end

return {
	"neovim/nvim-lspconfig",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = { "saghen/blink.cmp", "williamboman/mason.nvim" },
	opts = {
		servers = {
			cssls = {},
			html = {},
			jsonls = {},
			tofu_ls = {
				root_markers = { ".git" },
			},
			eslint = {
				-- graphql-eslint only keeps its documents cache when NODE is set (as under npm/pnpm);
				-- without it the first lint after 10s idle re-parses every gql document in the project
				cmd = { "vscode-eslint-language-server", "--stdio" },
				cmd_env = { NODE = vim.fn.exepath("node") },
			},
			ruff = {},
			oxfmt = {
				root_dir = root({ ".oxfmtrc.json", ".oxfmtrc.jsonc", "oxfmt.config.ts" }),
			},
			oxlint = {
				root_dir = root({ ".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts" }),
				-- pull diagnostics bypass `run` and queue a type-aware lint per keystroke; push + onSave lints once per (auto)save
				settings = { run = "onSave" },
				capabilities = { textDocument = { diagnostic = vim.NIL } },
			},
			helm_ls = {
				settings = {
					["helm-ls"] = {
						yamlls = {
							path = "yaml-language-server",
						},
					},
				},
			},
			yamlls = {},
			rust_analyzer = {},
			zuban = {},
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
			vim.lsp.config(server, config)
			vim.lsp.enable(server)
		end
	end,
}
