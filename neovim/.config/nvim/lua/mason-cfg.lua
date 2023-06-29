require("mason").setup()
local masonlsp = require("mason-lspconfig")
masonlsp.setup {
    ensure_installed = {
        "lua_ls",
        "rust_analyzer",
        "tsserver"
    },
}
masonlsp.setup_handlers {
        -- The first entry (without a key) will be the default handler
        -- and will be called for each installed server that doesn't have
        -- a dedicated handler.
        function (server_name) -- default handler (optional)
            require("lspconfig")[server_name].setup {}
        end,
        ["rust_analyzer"] = function ()
            require("rust-tools").setup {}
        end
    }
