require'fzf-lua'.setup {
  fullscreen = true,
  grep = {
    actions = {
      ['ctrl-y'] = function(_, opts)
        if opts.__FNCREF__ then
          require'fzf-lua'.grep({ continue_last_search = true })
          require'fzf-lua.actions'.ensure_insert_mode()
        else
          require'fzf-lua'.live_grep({ continue_last_search = true })
          require'fzf-lua.actions'.ensure_insert_mode()
        end
      end
    },
  },
}
