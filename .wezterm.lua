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

local function read_git_repos(path)
	local result = {}
	local file = io.open(path, "r")
	if not file then
		return result
	end

	for line in file:lines() do
		-- Match two whitespace-separated tokens
		local repo_name, repo_url = line:match("^(%S+)%s+(%S+)")
		if repo_name and repo_url then
			table.insert(result, { label = repo_url, id = repo_name })
		end
	end

	file:close()
	return result
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
	local projects = read_git_repos("/Users/joe/.gitrepos")

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

					wezterm.log_info("Running command...")
					win:perform_action(
						act.SpawnCommandInNewTab({
							args = {
								"/bin/zsh",
								"-i",
								"-c",
								string.format(
									"%s/git/joe-p/apple-dev-container/run_dev_container.sh %q %q",
									wezterm.home_dir,
									id,
									label
								),
							},
						}),
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
