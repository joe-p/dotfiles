# mypy: ignore-errors

from pathlib import Path

def draw_title(data) -> str:
    title = data["title"]
    if  title.startswith("💻"):
        return f"{data["index"]}: {title}"
    tab = data["tab"]
    new_title = f"{data["index"]}: {Path(tab.active_oldest_wd).name}" 

    if not tab.active_oldest_exe == "-zsh":
        new_title += f" ({tab.active_oldest_exe})"
    return new_title
