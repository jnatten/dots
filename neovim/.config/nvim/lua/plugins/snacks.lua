return {
	"folke/snacks.nvim",
	priority = 1000,
	lazy = false,
	keys = {
		{
			"<leader><space>",
			function()
				Snacks.picker.grep()
			end,
			desc = "Grep",
		},
		{
			"<leader>l",
			function()
				Snacks.picker.files()
			end,
			desc = "Find Files",
		},
		{
			"<leader>ff",
			function()
				Snacks.picker.files({ hidden = true })
			end,
			desc = "Find Files",
		},
		{
			"<leader>fg",
			function()
				Snacks.picker.git_files()
			end,
			desc = "Find Git Files",
		},
		{
			"<leader>fs",
			function()
				Snacks.picker.git_status()
			end,
			desc = "Find Git status",
		},
		{
			"<leader>fi",
			function()
				Snacks.picker.gh_issue()
			end,
			desc = "GitHub issues (open)",
		},
		{
			"<leader>fI",
			function()
				Snacks.picker.gh_issue({ state = "all" })
			end,
			desc = "GitHub issues (all)",
		},
		{
			"<leader>fn",
			function()
				Snacks.picker.gh_issue({ repo = "NDLANO/Issues" })
			end,
			desc = "NDLANO/Issues (open)",
		},
		{
			"<leader>fN",
			function()
				Snacks.picker.gh_issue({ repo = "NDLANO/Issues", state = "all" })
			end,
			desc = "NDLANO/Issues (all)",
		},
		{
			"<leader>fp",
			function()
				Snacks.picker.gh_pr()
			end,
			desc = "GitHub pull requests (open)",
		},
		{
			"<leader>fP",
			function()
				Snacks.picker.gh_pr({ state = "all" })
			end,
			desc = "GitHub pull requests (all)",
		},
		{
			"<leader>fr",
			function()
				Snacks.picker.gh_pr({ confirm = "gh_diff" })
			end,
			desc = "GitHub: pick a pull request and review its diff",
		},
		{
			"<leader>fd",
			function()
				Snacks.picker.diagnostics_buffer()
			end,
			desc = "Diagnostics in current buffer",
		},
		{
			"<leader>fD",
			function()
				Snacks.picker.diagnostics()
			end,
			desc = "Diagnostics in workspace",
		},
		{
			"<leader>fw",
			function()
				Snacks.picker.grep_word()
			end,
			desc = "Grep word under cursor / selection",
			mode = { "n", "x" },
		},
		{
			"<leader>fl",
			function()
				Snacks.picker.lines()
			end,
			desc = "Fuzzy find lines in current buffer",
		},
		{
			"<leader>fh",
			function()
				Snacks.picker.git_diff()
			end,
			desc = "Git: changed hunks in working copy",
		},
		{
			"<leader>fc",
			function()
				Snacks.picker.git_log_file({
					-- default confirm checks out the file at that commit; show the commit in diffview instead
					confirm = function(picker, item)
						picker:close()
						if item then
							vim.cmd(("DiffviewOpen %s^! -- %s"):format(item.commit, vim.fn.fnameescape(item.file)))
						end
					end,
				})
			end,
			desc = "Git: commits touching current file",
		},
		{
			"<leader>sr",
			function()
				Snacks.picker.resume()
			end,
			desc = "Resume",
		},
		{
			"<leader>ss",
			function()
				Snacks.picker()
			end,
			desc = "Picker!",
		},
		{
			"<leader>s/",
			function()
				Snacks.picker.search_history()
			end,
			desc = "Search History",
		},
		{
			"<leader>sp",
			function()
				Snacks.picker.projects()
			end,
			desc = "List projects",
		},
		{
			"<leader>sn",
			function()
				Snacks.notifier.show_history()
			end,
			desc = "Show notification history",
		},
		{
			"<leader>N",
			function()
				Snacks.notifier.hide()
			end,
			desc = "Hide notifications",
		},
		{
			"<leader>sb",
			function()
				Snacks.picker.buffers()
			end,
			desc = "Search open buffers",
		},
		{
			"<leader>p",
			function()
				Snacks.picker.commands()
			end,
			desc = "Search commands",
		},
		{
			"<leader>sj",
			function()
				Snacks.picker.jumps()
			end,
			desc = "Search jumps",
		},
		{
			"<leader><space>",
			function()
				local word = vim.fn.expand("<cword>")
				if word ~= "" then
					Snacks.picker.grep({ search = word })
				else
					Snacks.picker.grep()
				end
			end,
			desc = "Visual selection or word",
			mode = { "v" },
		},
		{
			"<leader><",
			function()
				local word = vim.fn.expand("<cword>")
				if word ~= "" then
					Snacks.picker.grep({ search = "<" .. word })
				else
					Snacks.picker.grep()
				end
			end,
			desc = "Visual selection or word",
			mode = { "v" },
		},
		{
			"<leader>z",
			function()
				Snacks.zen.zoom()
			end,
			desc = "Zoom current pane",
		},
		{
			"<leader>Z",
			function()
				Snacks.zen()
			end,
			desc = "Zen mode!",
		},
		{
			"<leader>sd",
			function()
				Snacks.dim.enable()
			end,
			desc = "Snacks: Dim the scopes!",
		},
		{
			"<leader>sD",
			function()
				Snacks.dim.disable()
			end,
			desc = "Snacks: Disable dim the scopes!",
		},
	},
	opts = {
		bigfile = { enabled = true },
		notifier = { enabled = true },
		quickfile = { enabled = true },
		statuscolumn = { enabled = true },
		words = { enabled = true },
		picker = {
			enabled = true,
			sources = {
				grep = {
					hidden = true,
					toggles = { hide_text = "T" },
					-- This transform function hides the search match from the file tree so we can avoid truncating file paths
					-- Useful if full filepath is more useful to skim than the text result
					transform = function(item, ctx)
						if ctx.picker.opts.hide_text then
							item.resolve = nil
						end
					end,
					win = {
						input = {
							keys = {
								["<a-t>"] = { "toggle_hide_text", mode = { "i", "n" } },
							},
						},
					},
				},
				grep_word = { hidden = true },
				files = { hidden = true },
			},
		},
	},
}
