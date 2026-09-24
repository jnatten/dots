return {
	-- graphql-eslint only keeps its documents cache when NODE is set (as under npm/pnpm);
	-- without it the first lint after 10s idle re-parses every gql document in the project
	cmd = { "vscode-eslint-language-server", "--stdio" },
	cmd_env = { NODE = vim.fn.exepath("node") },
}
