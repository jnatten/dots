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
Plug 'tpope/vim-sensible'                                                                                 " 'Sensible' defaults, not really sure if i use this
Plug 'junegunn/seoul256.vim'                                                                              " Theme
Plug 'preservim/nerdtree'                                                                                 " Worse filetree
Plug 'tpope/vim-surround'                                                                                 " Surround
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }                                                       " Fzf search
Plug 'junegunn/fzf.vim'                                                                                   " Fzf search
Plug 'kyazdani42/nvim-web-devicons'                                                                       " FileTree icons
Plug 'kyazdani42/nvim-tree.lua'                                                                           " FileTree
Plug 'easymotion/vim-easymotion'                                                                          " Jump around
Plug 'doums/darcula'                                                                                      " Theme
Plug 'terryma/vim-multiple-cursors'                                                                       " Sublime-style multi-cursors
Plug 'f-person/git-blame.nvim'                                                                            " Inline git-blame
Plug 'tpope/vim-fugitive'                                                                                 " Git commands
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}                                               " Better syntax highlighting

" ->  nvim-cmp
Plug 'hrsh7th/cmp-nvim-lsp'
Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/cmp-cmdline'
Plug 'hrsh7th/nvim-cmp'
Plug 'hrsh7th/cmp-vsnip'
Plug 'hrsh7th/vim-vsnip'
Plug 'hrsh7th/vim-vsnip-integ'
" -> nvim-cmp done



call plug#end()

set completeopt=menu,menuone,noselect

let g:gitblame_enabled = 0 " Disable inline git-blaming on startup

lua require('config')
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

