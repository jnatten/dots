return {
	"clabby/difftastic.nvim",
	main = "difftastic-nvim",
	dependencies = {
		"MunifTanjim/nui.nvim",
		"folke/snacks.nvim",
	},
	cmd = { "Difft", "DifftPick", "DifftPickRange" },
	opts = {
		download = true,
		snacks_picker = {
			enabled = true,
		},
	},
}
