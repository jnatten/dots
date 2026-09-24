return {
	on_init = function(client)
		-- Disable hover in favor of zuban
		client.server_capabilities.hoverProvider = false
	end,
}
