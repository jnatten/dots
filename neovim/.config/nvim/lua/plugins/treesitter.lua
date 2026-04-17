return {
	"nvim-treesitter/nvim-treesitter",
	event = { "BufReadPre", "BufNewFile" },
	build = ":TSUpdate",
	lazy = false,
	branch = "main",
	dependencies = {
		"windwp/nvim-ts-autotag",
	},
}
