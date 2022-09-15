let g:loaded_matchit = 1
syntax on
let mapleader=","
set nu

imap jj <Esc>

map <C-j> 5j
map <C-k> 5k

imap <C-j> <Down>
imap <C-k> <Up>

set clipboard=unnamedplus

set ignorecase
set smartcase

set nowrap

set laststatus=0 ruler

set hlsearch
map <silent> <C-l> :noh<CR>

map <F1> :NvimTreeToggle<CR>
map <leader>t :NvimTreeToggle<CR>
map <leader>l :GFiles!<CR>
map <leader>p :Telescope<CR>
map <leader>ø :Telescope find_files<CR>
map <A-l> :Files!<CR>
map <C-p> :Commands!<CR>
map <A-w> :bd<CR>
map <leader>s :ClangdSwitchSourceHeader<CR>

nnoremap <A-f> :Rg! <C-R><C-W><CR>
nnoremap <S-A-f> :Rg! <C-R><C-W>
vnoremap <A-f> "ay:Rg! <C-r>a<CR>
vnoremap <S-A-f> "ay:Rg! <C-r>a

nnoremap <leader>f :FzfLua grep<CR><C-R><C-W><CR>
nnoremap <leader>F :FzfLua grep<CR><C-R><C-W>
vnoremap <leader>f "ay:FzfLua grep<CR><C-r>a<CR>
vnoremap <leader>F "ay:FzfLua grep<CR><C-r>a
nnoremap <leader><leader>f :FzfLua live_grep<CR>
nnoremap <leader>r :FzfLua grep_last<CR>

nnoremap <leader>T :TroubleToggle<CR>

nnoremap <C-Left> <C-o>
nnoremap <C-Right> <C-i>
nnoremap <C-A-Left> <C-o>
nnoremap <C-A-Right> <C-i>

set shortmess-=F

set completeopt=menu,menuone,noselect

let g:gitblame_enabled = 0 " Disable inline git-blaming on startup

lua require('config')
lua require('lsp-cfg')
lua require('treesitter-cfg')
lua require('nvim-tree-cfg')
lua require('telescope-cfg')
lua require('typescript')
lua require('python')
lua require('barbar')
lua require('rust')
lua require('autocomplete')
lua require('indent-blankline-cfg')
lua require('fzf-lua-cfg')
lua require('clangd-cfg')
lua require('todo-cfg')
lua require('gitsigns-cfg')

nnoremap <silent> <S-Tab> <Cmd>BufferPrevious<CR>
nnoremap <silent> <Tab> <Cmd>BufferNext<CR>
nnoremap <silent> <A-l> <Cmd>BufferNext<CR>
nnoremap <silent> <A-h> <Cmd>BufferPrevious<CR>

colorscheme nightfox
set termguicolors
let g:lightline = { 'colorscheme': 'darcula' }

let g:auto_save = 1

set mouse=a
