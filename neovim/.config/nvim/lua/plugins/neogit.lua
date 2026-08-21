return {
	"NeogitOrg/neogit",
	cmd = { "Neogit", "NeogitCommit", "NeogitLogCurrent", "NeogitResetState" },
	dependencies = {
		"nvim-lua/plenary.nvim", -- required
		{ "dlyongemallo/diffview.nvim", optional = true }, -- optional - Diff integration

		-- Only one of these is needed.
		{ "nvim-telescope/telescope.nvim", optional = true }, -- optional
		{ "ibhagwan/fzf-lua", optional = true }, -- optional
		{ "echasnovski/mini.pick", optional = true }, -- optional
	},
	config = true,
}
