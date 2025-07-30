local function open_floating_window(lines)
	local buf = vim.api.nvim_create_buf(false, true) -- [scratch, nofile]
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

	local width = math.floor(vim.o.columns * 0.8)
	local height = math.floor(vim.o.lines * 0.7)
	local row = math.floor((vim.o.lines - height) / 2)
	local col = math.floor((vim.o.columns - width) / 2)

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		style = "minimal",
		border = "rounded",
		width = width,
		height = height,
		row = row,
		col = col,
	})

	vim.keymap.set("n", "q", function()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_win_close(win, true)
		end
	end, { buffer = buf, nowait = true })

	vim.bo[buf].filetype = "help"
	vim.bo[buf].modifiable = false
	vim.bo[buf].bufhidden = "wipe"
end

local function find_mapping_collisions_snacks()
	local all_modes = { "n", "v", "x", "o", "i", "c", "t" }
	local seen = {}
	local items = {}

	for _, mode in ipairs(all_modes) do
		local maps = vim.api.nvim_get_keymap(mode)
		for _, map1 in ipairs(maps) do
			for _, map2 in ipairs(maps) do
				if map1.lhs ~= map2.lhs and vim.startswith(map2.lhs, map1.lhs) then
					local key = mode .. ":" .. map1.lhs .. "->" .. map2.lhs
					if not seen[key] then
						local item = {
							label = string.format("[%s] %s ⟶ %s", mode, map1.lhs, map2.lhs), -- for display
							preview = { text = string.format("Mode: %s\nMapping: %s ⟶ %s", mode, map1.lhs, map2.lhs) },
							mode = mode,
							map1 = map1,
							map2 = map2,
							_type = "custom",
						}
						table.insert(items, item)
						seen[key] = true
					end
				end
			end
		end
	end

	if #items == 0 then
		vim.notify("No mapping collisions found!", vim.log.levels.INFO)
		return
	end

	Snacks.picker({
		title = "Mapping Collisions",
		items = items,
		format_item = function(item)
			return item.label
		end,
		preview = "preview",
		actions = {
			confirm = function(picker, item)
				if not item then
					return
				end
				picker:close()

				local function verbose_map(lhs, mode)
					local cmd = string.format("verbose %smap %s", mode, lhs)
					local output = vim.api.nvim_exec2(cmd, { output = true })
					return output.output
				end

				local map1_info = verbose_map(item.map1.lhs, item.mode)
				local map2_info = verbose_map(item.map2.lhs, item.mode)
				local maps = map1_info .. "\n\n" .. map2_info
				local mapping_info = "Mapping info:"

				open_floating_window({ mapping_info })
			end,
		},
	})
end

vim.api.nvim_create_user_command("MapCollisionsSnacks", find_mapping_collisions_snacks, {})
