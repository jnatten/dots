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
			"<leader><leader>f",
			function()
				Snacks.picker.files()
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
			"<leader>sR",
			function()
				Snacks.picker.resume()
			end,
			desc = "Resume",
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
				grep = { hidden = true },
			},
		},
	},
}
