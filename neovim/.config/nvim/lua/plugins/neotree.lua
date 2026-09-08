return {
    "nvim-neo-tree/neo-tree.nvim",
    cmd = "Neotree",
    branch = "v3.x",
    dependencies = {
        "nvim-lua/plenary.nvim",
        "nvim-tree/nvim-web-devicons",
        "MunifTanjim/nui.nvim",
        -- "3rd/image.nvim", -- Optional image support in preview window: See `# Preview Mode` for more information
    },
    opts = {
        filesystem = {
            filtered_items = {
                visible = true,
                hide_dotfiles = false,
                hide_gitignored = true,
            },
        },
        window = {
            mappings = {
                ["<leader>/"] = {
                    function(state)
                        local node = state.tree:get_node()
                        if not node then
                            return
                        end
                        local dir = Snacks.picker.util.dir(node.path)
                        require("neo-tree.command").execute({ action = "close" })
                        Snacks.picker.grep({ cwd = dir })
                    end,
                    desc = "grep in directory",
                },
            },
        },
    },
}
