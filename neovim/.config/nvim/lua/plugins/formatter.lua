-- local util = require "formatter.util"
-- return {
--   'mhartington/formatter.nvim',
--   opts = {
--     filetype = {
--    lua = {
--       -- "formatter.filetypes.lua" defines default configurations for the
--       -- "lua" filetype
--       require("formatter.filetypes.lua").stylua,
--
--       -- You can also define your own configuration
--       function()
--         -- Supports conditional formatting
--         if util.get_current_buffer_file_name() == "special.lua" then
--           return nil
--         end
--
--         -- Full specification of configurations is down below and in Vim help
--         -- files
--         return {
--           exe = "stylua",
--           args = {
--             "--search-parent-directories",
--             "--stdin-filepath",
--             util.escape_path(util.get_current_buffer_file_path()),
--             "--",
--             "-",
--           },
--           stdin = true,
--         }
--       end
--     }
--     }
--   }
-- }

return {
	"stevearc/conform.nvim",
	event = { "BufReadPre", "BufNewFile" },
	config = function()
		local conform = require("conform")
		conform.setup({
			formatters_by_ft = {
				javascript = { "prettier" },
				typescript = { "prettier" },
				javascriptreact = { "prettier" },
				typescriptreact = { "prettier" },
				css = { "prettier" },
				html = { "prettier" },
				json = { "prettier" },
				yaml = { "prettier" },
				markdown = { "prettier" },
				lua = { "stylua" },
				python = { "isort", "black" },
				rust = { "rustfmt", lsp_format = "fallback" },
			},
			format_on_save = {
				lsp_fallback = true,
				async = false,
				timeout_ms = 1000,
			},
		})

		vim.keymap.set({ "n", "v" }, "<leader><leader>k", function()
			conform.format({
				lsp_fallback = true,
				async = true,
				timeout_ms = 1000,
			})
		end, { desc = "Format file or range (in visual mode)" })
	end,
}
