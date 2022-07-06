local nvimtreemappings = {
  { 
    key = { "<C-k>" }, 
    action = "" 
  },
}

require("nvim-tree").setup({
  view = { 
    mappings = { 
      list = nvimtreemappings 
    }
  }
})
