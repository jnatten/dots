return {
	"folke/noice.nvim",
	event = "VeryLazy",
	enabled = true,
	opts = {
		cmdline = {
			enabled = false,
		},
		messages = {
			enabled = true,
		},
		routes = {
			{
				filter = {
					event = "msg_show",
					kind = "",
					find = "Press",
				},
				opts = { skip = false },
			},
		},
		lsp = {
			-- hover = {
			-- 	silent = true,
			-- },
			override = {
				["vim.lsp.util.convert_input_to_markdown_lines"] = true,
				["vim.lsp.util.stylize_markdown"] = true,
				["cmp.entry.get_documentation"] = true,
			},
		},
		presets = {
			bottom_search = true,
			command_palette = true,
			cmdline = false,
			long_message_to_split = true,
			lsp_doc_border = true,
		},
	},
}
