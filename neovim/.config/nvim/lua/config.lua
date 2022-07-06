local api = vim.api
local cmd = vim.cmd

local vim = vim
local execute = vim.api.nvim_command
local fn = vim.fn
-- ensure that packer is installed
local install_path = fn.stdpath('data')..'/site/pack/packer/opt/packer.nvim'
if fn.empty(fn.glob(install_path)) > 0 then
    execute('!git clone https://github.com/wbthomason/packer.nvim '..install_path)
    execute 'packadd packer.nvim'
end
vim.cmd('packadd packer.nvim')
local packer = require'packer'
local util = require'packer.util'
packer.init({
  package_root = util.join_paths(vim.fn.stdpath('data'), 'site', 'pack')
})
--- startup and add configure plugins
packer.startup(function()
  local use = use
  use { 'romgrk/barbar.nvim', requires = {'kyazdani42/nvim-web-devicons'} }
  use 'neovim/nvim-lspconfig'
  use 'nvim-lua/completion-nvim'
  use 'anott03/nvim-lspinstall'
  use({ "scalameta/nvim-metals", requires = { "nvim-lua/plenary.nvim", "mfussenegger/nvim-dap", } })
  use "jose-elias-alvarez/null-ls.nvim"
  use "jose-elias-alvarez/nvim-lsp-ts-utils"
  use { "briones-gabriel/darcula-solid.nvim", requires = "rktjmp/lush.nvim" }
  use "EdenEast/nightfox.nvim"
  use { 'nvim-telescope/telescope.nvim', requires = { {'nvim-lua/plenary.nvim'} } }
  use { 'nvim-telescope/telescope-dap.nvim' }
  use 'mfussenegger/nvim-dap'
  use {'nvim-telescope/telescope-ui-select.nvim' }
  use 'simrat39/rust-tools.nvim'
  use 'nvim-lua/plenary.nvim'
  use {
    "folke/trouble.nvim",
    requires = "kyazdani42/nvim-web-devicons",
    config = function()
      require("trouble").setup {}
    end
  }
  use 'tpope/vim-sensible'                                                                                 -- 'Sensible' defaults, not really sure if i use this
  use 'junegunn/seoul256.vim'                                                                              -- Theme
  use 'preservim/nerdtree'                                                                                 -- Worse filetree
  use 'tpope/vim-surround'                                                                                 -- Surround
  use 'kyazdani42/nvim-web-devicons'                                                                       -- FileTree icons
  use 'kyazdani42/nvim-tree.lua'                                                                           -- FileTree
  use 'easymotion/vim-easymotion'                                                                          -- Jump around
  use 'doums/darcula'                                                                                      -- Theme
  use 'terryma/vim-multiple-cursors'                                                                       -- Sublime-style multi-cursors
  use 'f-person/git-blame.nvim'                                                                            -- Inline git-blame
  use 'tpope/vim-fugitive'                                                                                 -- Git commands
  use { 'nvim-treesitter/nvim-treesitter', run = ":TSUpdate" }

  use { 'junegunn/fzf', run = ":call fzf#install()" }
  use { 'junegunn/fzf.vim' }

  -- ->  nvim-cmp
  use({ "hrsh7th/nvim-cmp", requires = { { "hrsh7th/cmp-nvim-lsp" }, { "hrsh7th/cmp-vsnip" }, { "hrsh7th/vim-vsnip" } }})
  use 'hrsh7th/cmp-nvim-lsp'
  use 'hrsh7th/cmp-buffer'
  use 'hrsh7th/cmp-path'
  use 'hrsh7th/cmp-cmdline'
  use 'hrsh7th/cmp-vsnip'
  use 'hrsh7th/vim-vsnip'
  use 'hrsh7th/vim-vsnip-integ'
  -- -> nvim-cmp done
  end
)


-- global
vim.opt_global.completeopt = { "menuone", "noinsert", "noselect" }
vim.opt_global.shortmess:remove("F"):append("c")
