vim.opt.list = true
-- vim.opt.listchars:append("space:⋅")
-- vim.opt.listchars:append("eol:↴")

require("ibl").setup()

-- Version 2 stuff, can probably be deleted yolo
-- require("indent_blankline").setup {
--     space_char_blankline = " ",
--     context_char = "▎",
--     show_current_context_start = true,
--     show_trailing_blankline_indent = false,
--     show_first_indent_level = true,
--     use_treesitter = true,
--     show_current_context = true,
--     context_patterns = {
--     	"class",
--     	"return",
--     	"function",
--     	"method",
--     	"^if",
--     	"^while",
--     	"jsx_element",
--     	"^for",
--     	"^object",
--     	"^table",
--     	"block",
--     	"arguments",
--     	"if_statement",
--     	"else_clause",
--     	"jsx_element",
--     	"jsx_self_closing_element",
--     	"try_statement",
--     	"catch_clause",
--     	"import_statement",
--     	"operation_type",
--     }
-- }
