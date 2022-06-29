syntax on
let mapleader=","
set nu

imap jj <Esc>

map <C-j> 5j
map <C-k> 5k

set clipboard=unnamed

set hlsearch
map <silent> <C-l> :noh<CR>

map <F1> :NvimTreeToggle<CR>
map <leader>t :NvimTreeToggle<CR>
map <leader>l :GFiles<CR>
map <A-l> :Files<CR>
map <C-p> :Commands<CR>
map <C-y> :Rg 
nnoremap <C-Left> <C-o>
nnoremap <C-Right> <C-i>
nnoremap <C-A-Left> <C-o>
nnoremap <C-A-Right> <C-i>
" map <S-p> :Commands<CR>

set shortmess-=F

call plug#begin(has('nvim') ? stdpath('data') . '/plugged' : '~/.vim/plugged')
Plug 'tpope/vim-sensible'
Plug 'junegunn/seoul256.vim'
Plug 'preservim/nerdtree'
Plug 'tpope/vim-surround'
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'kyazdani42/nvim-web-devicons'
Plug 'kyazdani42/nvim-tree.lua'
Plug 'easymotion/vim-easymotion'
Plug 'doums/darcula'
Plug 'terryma/vim-multiple-cursors'
Plug 'f-person/git-blame.nvim'
call plug#end()

lua require('config')
lua require('typescript')
lua require('python')
lua require('barbar')
lua require('rust')

" nnoremap <Tab> :bnext<CR>
" nnoremap <S-Tab> :bprevious<CR>
nnoremap <silent> <S-Tab> <Cmd>BufferPrevious<CR>
nnoremap <silent> <Tab> <Cmd>BufferNext<CR>
nnoremap <silent> <A-l> <Cmd>BufferNext<CR>
nnoremap <silent> <A-h> <Cmd>BufferPrevious<CR>

colorscheme nightfox
set termguicolors
let g:lightline = { 'colorscheme': 'darcula' }

