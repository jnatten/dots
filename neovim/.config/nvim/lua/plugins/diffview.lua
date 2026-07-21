return {
	"dlyongemallo/diffview.nvim",
	cmd = {
		"DiffviewOpen",
		"DiffviewFileHistory",
		"DiffviewMergeFiles",
		"DiffviewDiffDirs",
	},
	opts = {
		view = {
			merge_tool = {
				layout = "diff4_mixed",
				winbar_info = true,
			},
		},
	},
}
