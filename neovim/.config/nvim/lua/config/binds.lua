local map = vim.keymap.set
local options = { noremap = true }
local cmd_options = { noremap = true, silent = true }

local mall = { "i", "n", "v" }
local vn = { "n", "v" }

map("i", "jj", "<Esc>", options)
map(vn, "<C-j>", "5j", options)
map(vn, "<C-k>", "5k", options)

map(vn, "<leader>j", "i<CR><Esc>k$", options) -- Split to newline and go back

map("i", "<C-j>", "<Down>", options)
map("i", "<C-k>", "<Up>", options)
map("i", "<C-h>", "<Left>", options)
map("i", "<C-l>", "<Right>", options)
map(vn, "<Space>", "/", cmd_options)
map(vn, "<C-l>", ":noh<CR>", cmd_options)
map(mall, "<A-w>", ":bd<CR>", cmd_options)
map("n", "<A-,>", ":bprev<CR>", cmd_options)
map("n", "<A-.>", ":bnext<CR>", cmd_options)

map(mall, "<leader>t", ":Neotree toggle<CR>", cmd_options)

-- map(mall, "<leader>l", ":FzfLua files<CR>", cmd_options)
-- map("n", "<leader>f", ":FzfLua grep<CR><C-R><C-W><CR>", cmd_options)
-- map("n", "<leader>F", ":FzfLua grep<CR><C-R><C-W>", cmd_options)

map("v", "<leader>f", '"ay:FzfLua grep<CR><C-r>a<CR>', cmd_options)
map("v", "<leader>F", '"ay:FzfLua grep<CR><C-r>a', cmd_options)
map("n", "<leader><leader>f", ":FzfLua live_grep<CR>", cmd_options)
map("n", "<leader><leader>f", ":FzfLua live_grep<CR>", cmd_options)
map("n", "<leader><leader>g", ":Neogit<CR>", cmd_options)
map("n", "<leader><leader>l", ":Lazy<CR>", cmd_options)

-- lsp binds
map("n", "<leader>gd", "<cmd>lua vim.lsp.buf.definition()<CR>")
map("n", "<leader>gi", "<cmd>lua vim.lsp.buf.implementation()<CR>")
map("n", "<leader>gr", "<cmd>lua vim.lsp.buf.references()<CR>")
map("n", "<leader>gds", "<cmd>lua vim.lsp.buf.document_symbol()<CR>")
map("n", "<leader>gws", "<cmd>lua vim.lsp.buf.workspace_symbol()<CR>")
--
map("n", "gd", "<cmd>Telescope lsp_definitions<CR>")
map("n", "gi", "<cmd>Telescope lsp_implementations<CR>")
map("n", "gr", "<cmd>Telescope lsp_references<CR>")
map("n", "gds", "<cmd>Telescope lsp_document_symbols<CR>")
map("n", "gws", "<cmd>Telescope lsp_workspace_symbols<CR>")
--
map("n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>")
map("n", "K", "<cmd>lua vim.lsp.buf.hover()<CR>")
map("n", "<leader>cl", [[<cmd>lua vim.lsp.codelens.run()<CR>]])
map("n", "<leader>sh", [[<cmd>lua vim.lsp.buf.signature_help()<CR>]])
map("n", "<leader>r", "<cmd>lua vim.lsp.buf.rename()<CR>")
map("n", "<leader>fo", "<cmd>lua vim.lsp.buf.formatting()<CR>")
map("n", "<leader>ca", "<cmd>lua vim.lsp.buf.code_action()<CR>")
map("n", "<leader>ws", '<cmd>lua require"metals".hover_worksheet()<CR>')
map("n", "<leader>aa", [[<cmd>lua vim.diagnostic.setqflist()<CR>]]) -- all workspace diagnostics
map("n", "<leader>ae", [[<cmd>lua vim.diagnostic.setqflist({severity = "E"})<CR>]]) -- all workspace errors
map("n", "<leader>aw", [[<cmd>lua vim.diagnostic.setqflist({severity = "W"})<CR>]]) -- all workspace warnings
map("n", "<leader>d", "<cmd>lua vim.diagnostic.setloclist()<CR>") -- buffer diagnostics only
map("n", "[c", "<cmd>lua vim.diagnostic.goto_prev { wrap = false }<CR>")
map("n", "gn", "<cmd>lua vim.diagnostic.goto_next { wrap = true }<CR>")

map("n", "<leader><leader>e", "<cmd>lua vim.diagnostic.goto_prev { wrap = false }<CR>")
map("n", "<leader>e", "<cmd>lua vim.diagnostic.goto_next { wrap = true }<CR>")
