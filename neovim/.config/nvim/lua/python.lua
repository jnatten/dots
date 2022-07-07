local lspconfig = require("lspconfig")
-- lspconfig.jedi_language_server.setup{}
lspconfig.pylsp.setup{}

-- lspconfig.pylsp.setup{
-- 	settings = {
-- 		pylsp = {
-- 			plugins = {
-- 				mypy = { enabled = false }
-- 			}
-- 		}
-- 	}
-- }
