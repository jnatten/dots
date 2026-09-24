return {
	root_dir = function(bufnr, on_dir)
		local root = vim.fs.root(bufnr, { ".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts" })
		if root then
			on_dir(root)
		end
	end,
	-- pull diagnostics bypass `run` and queue a type-aware lint per keystroke; push + onSave lints once per (auto)save
	settings = { run = "onSave" },
	capabilities = { textDocument = { diagnostic = vim.NIL } },
}
