return {
	root_dir = function(bufnr, on_dir)
		local root = vim.fs.root(bufnr, { ".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts" })
		if root then
			on_dir(root)
		end
	end,
	settings = {
		run = "onSave",
		fixKind = "dangerous_fix_or_suggestion",
	},
	capabilities = { textDocument = { diagnostic = vim.NIL } },
}
