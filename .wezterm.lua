-- Pull in the wezterm API
local wezterm = require("wezterm")

-- Build the initial config
local config = wezterm.config_builder()

-- Change font and color scheme
config.font = wezterm.font 'MesloLGM Nerd Font Mono'
config.color_scheme = "Catppuccin Mocha" -- or Macchiato, Frappe, Latte

-- wezterm.action is used often, so save it as a local variable
local act = wezterm.action

-- The status in the top right should always be the active worksapce
wezterm.on('update-right-status', function(window, pane)
	window:set_right_status(window:active_workspace())
end)

-- Function for fuzzy picking a git repo as a workspace
-- based on https://github.com/wez/wezterm/discussions/4796
local function select_workspace(window, pane)
	local projects = {}

	local success, stdout, stderr = wezterm.run_child_process({
		"/opt/homebrew/bin/fd",
		"--hidden",
		"--no-ignore",
		"^.git$",
		"--max-depth=3",
		"--prune", -- don't search .git/
		os.getenv("HOME") .. "/git"
	})

	if not success then
		wezterm.log_error("Failed to run fd: " .. stderr)
		return
	end

	for line in stdout:gmatch("([^\n]*)\n?") do
		local project = line:gsub("/.git.*$", "")
		local label = project
		local id = project:gsub(".*/", "")
		table.insert(projects, { label = tostring(label), id = tostring(id) })
	end

	window:perform_action(
		act.InputSelector({
			action = wezterm.action_callback(function(win, _, id, label)
				if not id and not label then
					wezterm.log_info("Cancelled")
				else
					wezterm.log_info("Selected " .. label)
					win:perform_action(
						act.SwitchToWorkspace({ name = id, spawn = { cwd = label } }),
						pane
					)
				end
			end),
			fuzzy = true,
			title = "Select project",
			choices = projects,
		}),
		pane
	)
end

config.keys = {
	{
		key = 'P',
		mods = 'SUPER',
		action = act.ActivateCommandPalette,
	},
	{
		key = 'd',
		mods = 'SUPER',
		action = act.SwitchToWorkspace({ name = "default" })
	},
	{
		key = 'w',
		mods = 'SUPER',
		action = wezterm.action_callback(select_workspace)
	},
}

return config
