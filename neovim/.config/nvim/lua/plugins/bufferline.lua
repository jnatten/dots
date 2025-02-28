return {
	"akinsho/bufferline.nvim",
	event = "VeryLazy",
	opts = {
		diagnostics = "nvim_lsp",
		diagnostics_indicator = function(count)
			return "(" .. count .. ")"
		end,
		truncate_names = false,
		show_buffer_close_icons = false,
		close_icon = "",
		offsets = {
			{
				filetype = "neo-tree",
				text = "🤯",
				highlight = "NeoTreeNormal",
				text_align = "left",
			},
		},
	},
	config = function(_, opts)
		require("bufferline").setup({
			-- highlights = require("catppuccin.groups.integrations.bufferline").get(),
			options = opts,
		})
	end,
}
