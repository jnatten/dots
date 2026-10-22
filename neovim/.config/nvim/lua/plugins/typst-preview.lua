return {
	"chomosuke/typst-preview.nvim",
	ft = "typst",
	version = "1.*",
	opts = {
		dependencies_bin = { tinymist = "tinymist" },
	},
	keys = {
		{
			"<leader><leader>p",
			"<cmd>TypstPreviewToggle<cr>",
			ft = "typst",
			desc = "Typst: Toggle browser preview",
		},
	},
}
