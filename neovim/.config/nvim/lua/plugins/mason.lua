return {
	{
		"williamboman/mason.nvim",
		cmd = { "Mason", "MasonInstall", "MasonUpdate", "MasonUninstall", "MasonUninstallAll", "MasonLog" },
		dependencies = {
			"williamboman/mason-lspconfig.nvim",
		},
		config = function()
			require("mason").setup()
		end,
	},
	{
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		cmd = { "MasonToolsInstall", "MasonToolsUpdate", "MasonToolsClean" },
		dependencies = { "williamboman/mason.nvim" },
		opts = {
			-- installs are driven by :MasonToolsInstall, not on every startup
			run_on_start = false,
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
				"tree-sitter-cli",
				"vtsls",
			},
		},
	},
}
