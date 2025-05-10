-- Pull in the wezterm API
local wezterm = require("wezterm")

-- Build the initial config
local config = wezterm.config_builder()

local function get_appearance()
	if wezterm.gui then
		return wezterm.gui.get_appearance()
	end
	return "Dark"
end

local function scheme_for_appearance()
	if get_appearance():find("Dark") then
		return "Catppuccin Macchiato" -- or Macchiato, Frappe, Latte
	else
		return "Catppuccin Latte"
	end
end

-- Change font and color scheme
config.font = wezterm.font("MesloLGM Nerd Font Mono")
config.color_scheme = scheme_for_appearance()
config.font_size = 14

-- wezterm.action is used often, so save it as a local variable
local act = wezterm.action

-- The status in the top right should always be the active worksapce
wezterm.on("update-right-status", function(window, pane)
	window:set_right_status(window:active_workspace())
end)

-- Function for fuzzy picking a git repo as a workspace
-- based on https://github.com/wez/wezterm/discussions/4796
local function select_workspace(window, pane)
	local projects = {
		{ label = os.getenv("HOME") .. "/.config/nvim", id = "nvim" },
	}

	local success, stdout, stderr = wezterm.run_child_process({
		"/opt/homebrew/bin/fd",
		"--hidden",
		"--no-ignore",
		"^.git$",
		"--max-depth=3",
		"--prune", -- don't search .git/
		os.getenv("HOME") .. "/git",
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

					local tab_title = label:match("^.*/(.*)$")
					local tabs = win:mux_window():tabs()
					for i = 1, #tabs do
						if tabs[i]:get_title() == tab_title then
							tabs[i]:activate()
							return
						end
					end

					win:perform_action(
						act.SpawnCommandInNewTab({ args = { "/bin/zsh", "-l", "-c", "nvim" }, cwd = label }),
						pane
					)
					win:active_tab():set_title(tab_title)
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
		key = "P",
		mods = "SUPER",
		action = act.ActivateCommandPalette,
	},
	{
		key = "d",
		mods = "SUPER",
		action = act.SwitchToWorkspace({ name = "default" }),
	},
	{
		key = "k",
		mods = "SUPER",
		action = wezterm.action_callback(select_workspace),
	},
}

return config
