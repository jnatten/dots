local map = vim.keymap.set
local del = vim.keymap.del
local options = { noremap = true }
local cmd_options = { noremap = true, silent = true }

local mall = { "i", "n", "v" }
local vn = { "n", "v" }

map("i", "jj", "<Esc>", options)
map(vn, "<C-j>", "5j", options)
map(vn, "<C-k>", "5k", options)

map(vn, "<leader>j", "i<CR><Esc>k$", { desc = "Split line at cursor position while staying on line" })

map("i", "<C-j>", "<Down>", options)
map("i", "<C-k>", "<Up>", options)
map("i", "<C-h>", "<Left>", options)
map("i", "<C-l>", "<Right>", options)
map(vn, "<Space>", "/", options)
map(vn, "<C-l>", ":noh<CR>", cmd_options)
map(mall, "<A-w>", "<cmd>lua Snacks.bufdelete()<CR>", { desc = "Close buffer" })
map(mall, "<A-b>", "<cmd>lua Snacks.picker.buffers()<CR>", { desc = "Search open buffers" })
map("n", "<leader>qs", "<cmd>lua require('persistence').load()<CR>", { desc = "Session: Load last session" })
map("n", "<leader>qS", "<cmd>lua require('persistence').select()<CR>", { desc = "Session: Select" })
map(
	"n",
	"<leader>ql",
	"<cmd>lua require('persistence').load({ last = true })<CR>",
	{ desc = "Session: Load last session" }
)
map("n", "<leader>qd", "<cmd>lua require('persistence').stop()<CR>", { desc = "Session: Stop" })
map(mall, "<A-q>", "<cmd>:close<CR>", { desc = "Close pane" })
map("n", "<A-,>", ":bprev<CR>", cmd_options)
map("n", "<A-.>", ":bnext<CR>", cmd_options)
map("n", "<A-<>", ":vertical resize +5<CR>", cmd_options)
map("n", "<A->>", ":vertical resize -5<CR>", cmd_options)

map("n", "<A-H>", ":vertical resize +5<CR>", cmd_options)
map("n", "<A-L>", ":vertical resize -5<CR>", cmd_options)
map("n", "<A-J>", ":resize -5<CR>", cmd_options)
map("n", "<A-K>", ":resize +5<CR>", cmd_options)

map(mall, "<leader>t", ":Neotree toggle float<CR>", cmd_options)
map(mall, "<leader>T", ":Neotree reveal float<CR>", cmd_options)

map("n", "<leader><leader>g", ":Neogit<CR>", cmd_options)
map("n", "<leader><leader>l", ":Lazy<CR>", cmd_options)
map("n", "<leader><leader>m", ":Mason<CR>", cmd_options)

-- lsp binds
vim.b.disable_import_filtering = false
vim.keymap.set("n", "<leader>sI", function()
	vim.b.disable_import_filtering = not vim.b.disable_import_filtering
	print("Import filtering import set to: " .. tostring(vim.b.import_filtering))
end, { desc = "Toggle import filtering in lsp" })

map("n", "gd", "<cmd>lua Snacks.picker.lsp_definitions()<CR>", { desc = "lsp: Goto definition" })
map("n", "gi", "<cmd>lua Snacks.picker.lsp_implementations()<CR>", { desc = "lsp: Goto implementation" })

map("n", "gr", function()
	if vim.b.disable_import_filtering then
		Snacks.picker.lsp_references()
	else
		Snacks.picker.lsp_references({ pattern = "!import" })
	end
end, { desc = "lsp: Goto references" })

map("n", "gt", "<cmd>lua Snacks.picker.lsp_type_definitions()<CR>", { desc = "lsp: Goto type definitions" })
map("n", "gss", "<cmd>lua Snacks.picker.lsp_symbols()<CR>", { desc = "lsp: Symbols" })
map("n", "gws", "<cmd>lua Snacks.picker.lsp_workspace_symbols()<CR>", { desc = "lsp: Workspace symbols" })
map("n", "<leader>y", "<cmd>lua require('package-info').show()<cr>", { desc = "Update package.json" })
map("n", "<leader><leader>y", "<cmd>lua require('package-info').update()<cr>", { desc = "Update package.json" })
--
map("n", "gD", "<cmd>lua Snacks.picker.lsp_declarations()<CR>")
map("n", "K", "<cmd>lua vim.lsp.buf.hover()<CR>")
map("n", "<leader>k", "<cmd>lua vim.diagnostic.open_float()<CR>")
map("n", "<leader>cl", [[<cmd>lua vim.lsp.codelens.run()<CR>]])
map("n", "<leader>sh", [[<cmd>lua vim.lsp.buf.signature_help()<CR>]])
map("n", "<leader>r", "<cmd>lua vim.lsp.buf.rename()<CR>", { desc = "lsp: Rename" })
map("n", "<leader>fo", "<cmd>lua vim.lsp.buf.formatting()<CR>", { desc = "lsp: Format" })
map("n", "<leader>ca", "<cmd>lua vim.lsp.buf.code_action()<CR>", { desc = "lsp: Code action" })
map("n", "<leader>ws", '<cmd>lua require"metals".hover_worksheet()<CR>')
map("n", "<leader>aa", [[<cmd>lua vim.diagnostic.setqflist()<CR>]]) -- all workspace diagnostics
map("n", "<leader>ae", [[<cmd>lua vim.diagnostic.setqflist({severity = "E"})<CR>]]) -- all workspace errors
map("n", "<leader>aw", [[<cmd>lua vim.diagnostic.setqflist({severity = "W"})<CR>]]) -- all workspace warnings
map("n", "<leader>d", "<cmd>lua vim.diagnostic.setloclist()<CR>") -- buffer diagnostics only
map("n", "<leader>dc", "<cmd>:DapContinue<CR>", { desc = "lsp: Start / continue debugging" })
map("n", "<leader>dt", "<cmd>:DapToggleBreakpoint<CR>", { desc = "lsp: Toggle breakpoint on line" })
map("n", "<leader><leader>d", "<cmd>lua require('dapui').toggle()<CR>", { desc = "lsp: Toggle debugging UI" })

-- These seem to be default binds that conflict with `gr`
-- That makes stuff slow so lets not do that
del("n", "grr")
del("n", "gra")
del("n", "gri")
del("n", "grn")
del("n", "grt")

map(
	"n",
	"<leader><leader>e",
	"<cmd>lua vim.diagnostic.goto_prev { wrap = false }<CR>",
	{ desc = "lsp: Goto prev error" }
)
map("n", "<leader>e", "<cmd>lua vim.diagnostic.goto_next { wrap = true }<CR>", { desc = "lsp: Goto next error" })
map("n", "<leader>ai", ":CodeCompanionChat toggle<CR>", { desc = "Code companion chat" })
map("n", "<leader><leader>ai", ":CodeCompanionActions<CR>", { desc = "Code companion actions select" })
