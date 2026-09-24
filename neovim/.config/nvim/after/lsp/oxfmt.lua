return {
	root_dir = function(bufnr, on_dir)
		local root = vim.fs.root(bufnr, { ".oxfmtrc.json", ".oxfmtrc.jsonc", "oxfmt.config.ts" })
		if root then
			on_dir(root)
		end
	end,
}
