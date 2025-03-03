return {
	"lewis6991/gitsigns.nvim",
	config = function()
		local gitsigns = require("gitsigns")
		gitsigns.setup({
			signs = {
				add = { text = "│" },
				change = { text = "│" },
				delete = { text = "_" },
				topdelete = { text = "‾" },
				changedelete = { text = "~" },
				untracked = { text = "┆" },
			},
			signcolumn = true, -- Toggle with `:Gitsigns toggle_signs`
			numhl = false, -- Toggle with `:Gitsigns toggle_numhl`
			linehl = false, -- Toggle with `:Gitsigns toggle_linehl`
			word_diff = false, -- Toggle with `:Gitsigns toggle_word_diff`
			watch_gitdir = {
				interval = 1000,
				follow_files = true,
			},
			attach_to_untracked = true,
			current_line_blame = false, -- Toggle with `:Gitsigns toggle_current_line_blame`
			current_line_blame_opts = {
				virt_text = true,
				virt_text_pos = "eol", -- 'eol' | 'overlay' | 'right_align'
				delay = 1000,
				ignore_whitespace = false,
			},
			current_line_blame_formatter = "<author>, <author_time:%Y-%m-%d> - <summary>",
			sign_priority = 6,
			update_debounce = 100,
			status_formatter = nil, -- Use default
			max_file_length = 40000, -- Disable if file is longer than this (in lines)
			preview_config = {
				-- Options passed to nvim_open_win
				border = "single",
				style = "minimal",
				relative = "cursor",
				row = 0,
				col = 1,
			},
		})

		local map = vim.keymap.set
		map("n", "<A-r>", gitsigns.reset_hunk, { desc = "git: Reset hunk" })
		map("n", "<leader>hr", gitsigns.reset_hunk, { desc = "git: Reset hunk" })
		map("n", "<leader>hp", gitsigns.preview_hunk, { desc = "git: Preview hunk" })
		map("n", "<leader>hs", gitsigns.stage_hunk, { desc = "git: Stage/unstage hunk" })
		map("n", "<leader>hS", gitsigns.stage_buffer, { desc = "git: Stage/unstage buffer" })
		map("n", "<A-n>", function()
			gitsigns.nav_hunk("next")
		end, { desc = "git: Goto next hunk" })
		map("n", "<A-p>", function()
			gitsigns.nav_hunk("prev")
		end, { desc = "git: Goto prev hunk" })
	end,
}
