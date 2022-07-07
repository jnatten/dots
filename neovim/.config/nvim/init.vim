syntax on
let mapleader=","
set nu

imap jj <Esc>

map <C-j> 5j
map <C-k> 5k

imap <C-j> <Down>
imap <C-k> <Up>

set clipboard=unnamedplus

set hlsearch
map <silent> <C-l> :noh<CR>

map <F1> :NvimTreeToggle<CR>
map <leader>t :NvimTreeToggle<CR>
map <leader>l :GFiles<CR>
map <leader>p :Telescope<CR>
map <A-l> :Files<CR>
map <C-p> :Commands<CR>
map <C-y> :Rg 
map <A-w> :bd<CR>

nnoremap <C-Left> <C-o>
nnoremap <C-Right> <C-i>
nnoremap <C-A-Left> <C-o>
nnoremap <C-A-Right> <C-i>
" map <S-p> :Commands<CR>

set shortmess-=F

call plug#begin(has('nvim') ? stdpath('data') . '/plugged' : '~/.vim/plugged')

call plug#end()

set completeopt=menu,menuone,noselect

let g:gitblame_enabled = 0 " Disable inline git-blaming on startup

lua require('config')
lua require('lsp-cfg')
lua require('nvim-tree-cfg')
lua require('telescope-cfg')
lua require('typescript')
lua require('python')
lua require('barbar')
lua require('rust')
lua require('autocomplete')

" nnoremap <Tab> :bnext<CR>
" nnoremap <S-Tab> :bprevious<CR>
nnoremap <silent> <S-Tab> <Cmd>BufferPrevious<CR>
nnoremap <silent> <Tab> <Cmd>BufferNext<CR>
nnoremap <silent> <A-l> <Cmd>BufferNext<CR>
nnoremap <silent> <A-h> <Cmd>BufferPrevious<CR>

colorscheme nightfox
set termguicolors
let g:lightline = { 'colorscheme': 'darcula' }

set updatetime=250 " git gutter update time
