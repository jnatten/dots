local map = vim.keymap.set
local options = { noremap = true }
local cmd_options = { noremap = true, silent = true }

local mall = {"i", "n", "v"}
local vn = {"n", "v"}

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

map(mall, "<leader>t", ":Neotree toggle<CR>", cmd_options)


map(mall, "<leader>l", ":FzfLua files<CR>", cmd_options)
map("n", "<leader>f", ":FzfLua grep<CR><C-R><C-W><CR>", cmd_options)
map("n", "<leader>F", ":FzfLua grep<CR><C-R><C-W>", cmd_options)

map("v", "<leader>f", '"ay:FzfLua grep<CR><C-r>a<CR>', cmd_options)
map("v", "<leader>F", '"ay:FzfLua grep<CR><C-r>a', cmd_options)
map("n", "<leader><leader>f", ":FzfLua live_grep<CR>", cmd_options)
map("n", "<leader><leader>f", ":FzfLua live_grep<CR>", cmd_options)


