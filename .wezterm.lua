local wezterm = require("wezterm")
local config = wezterm.config_builder()

local LIMA_VM = "dev"
local LIMACTL = "/opt/homebrew/bin/limactl"

local function get_appearance()
	if wezterm.gui then
		return wezterm.gui.get_appearance()
	end
	return "Dark"
end

local function scheme_for_appearance()
	if get_appearance():find("Dark") then
		return "Catppuccin Macchiato"
	else
		return "Catppuccin Latte"
	end
end

config.font = wezterm.font("MesloLGM Nerd Font Mono")
config.color_scheme = scheme_for_appearance()
config.font_size = 14

local act = wezterm.action

wezterm.on("update-right-status", function(window, pane)
	window:set_right_status(window:active_workspace())
end)

local function select_workspace(window, pane)
	-- Resolve $HOME inside the VM
	local ok, vm_home, err = wezterm.run_child_process({
		LIMACTL,
		"shell",
		LIMA_VM,
		"sh",
		"-c",
		"echo $HOME",
	})
	if not ok then
		wezterm.log_error("Failed to resolve VM home: " .. (err or ""))
		return
	end
	vm_home = vm_home:gsub("%s+$", "")

	-- Pinned projects (paths inside the VM)
	local projects = {
		{ label = vm_home .. "/.config/nvim", id = "nvim" },
		{ label = vm_home .. "/.pi/agent", id = "pi-agent-config" },
	}

	local success, stdout, stderr = wezterm.run_child_process({
		LIMACTL,
		"shell",
		LIMA_VM,
		vm_home .. "/.local/share/mise/shims/fd",
		"--hidden",
		"--no-ignore",
		"^.git$",
		"--max-depth=3",
		"--prune",
		vm_home .. "/git",
	})

	if not success then
		wezterm.log_error("Failed to run fd in lima: " .. stderr)
		return
	end

	for line in stdout:gmatch("([^\n]*)\n?") do
		if line ~= "" then
			local project = line:gsub("/.git.*$", "")
			local id = project:gsub(".*/", "")
			table.insert(projects, { label = project, id = id })
		end
	end

	window:perform_action(
		act.InputSelector({
			action = wezterm.action_callback(function(win, _, id, label)
				if not id and not label then
					wezterm.log_info("Cancelled")
					return
				end
				wezterm.log_info("Selected " .. label)
				local tab_title = label:match("^.*/(.*)$") or label

				-- If a tab with this title already exists, jump to it
				local tabs = win:mux_window():tabs()
				for i = 1, #tabs do
					if tabs[i]:get_title() == tab_title then
						tabs[i]:activate()
						return
					end
				end

				-- Spawn nvim inside the VM via login zsh, with cwd set to the project dir
				win:perform_action(
					act.SpawnCommandInNewTab({
						args = {
							LIMACTL,
							"shell",
							"--workdir",
							label,
							LIMA_VM,
							"zsh",
							"-l",
							"-i",
							"-c",
							"nvim",
						},
					}),
					pane
				)
				win:active_tab():set_title(tab_title)
			end),
			fuzzy = true,
			title = "Select project",
			choices = projects,
		}),
		pane
	)
end

config.keys = {
	{ key = "P", mods = "SUPER", action = act.ActivateCommandPalette },
	{ key = "d", mods = "SUPER", action = act.SwitchToWorkspace({ name = "default" }) },
	{ key = "k", mods = "SUPER", action = wezterm.action_callback(select_workspace) },
}

return config
