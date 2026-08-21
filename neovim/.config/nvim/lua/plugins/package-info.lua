return {
	"vuki656/package-info.nvim",
	event = "BufReadPre package.json",
	version = false,
	config = function()
		require("package-info").setup({
			autostart = false,
			hide_unstable_versions = true,
			hide_up_to_date = true,
			package_manager = "yarn",
		})
	end,
}
