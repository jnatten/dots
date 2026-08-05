return {
	"dlyongemallo/diffview.nvim",
	cmd = {
		"DiffviewOpen",
		"DiffviewFileHistory",
		"DiffviewMergeFiles",
		"DiffviewDiffDirs",
	},
	opts = {
		auto_close_on_empty = true,
		clean_up_buffers = true,
		enhanced_diff_hl = true,
		hide_merge_artifacts = true,
		show_help_hints = false,
		use_icons = true,
		view = {
			merge_tool = {
				layout = "diff4_mixed",
				disable_diagnostics = true,
				winbar_info = true,
			},
			cycle_layouts = {
				merge_tool = { "diff4_mixed", "diff3_mixed", "diff3_horizontal", "diff1_plain" },
			},
		},
	},
}
