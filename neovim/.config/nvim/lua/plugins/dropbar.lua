return {
	"Bekaboo/dropbar.nvim",
	event = { "BufReadPost", "BufNewFile" },
	keys = {
		{ "<leader>;", function() require("dropbar.api").pick() end, desc = "Pick symbols in winbar" },
		{
			"<leader>ub",
			function()
				vim.g.dropbar_enabled = vim.g.dropbar_enabled == false
				for _, win in ipairs(vim.api.nvim_list_wins()) do
					if vim.g.dropbar_enabled then
						require("dropbar.utils.bar").attach(vim.api.nvim_win_get_buf(win), win, {})
					elseif vim.wo[win].winbar == "%{%v:lua.dropbar()%}" then
						vim.wo[win][0].winbar = ""
					end
				end
			end,
			desc = "Toggle dropbar",
		},
	},
	config = function()
		local default_enable = require("dropbar.configs").opts.bar.enable
		require("dropbar").setup({
			bar = {
				enable = function(buf, win, info)
					return vim.g.dropbar_enabled ~= false and default_enable(buf, win, info)
				end,
			},
		})
	end,
}
