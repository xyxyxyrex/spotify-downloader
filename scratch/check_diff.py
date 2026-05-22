import subprocess

try:
    diff = subprocess.check_output(["git", "diff", "tauri-gui/src/main.js"], encoding="utf-8")
    lines = diff.splitlines()
    print("SEARCHING GIT DIFF FOR REMOVED/CHANGED LINES:")
    removed_plugins = 0
    for line in lines:
        if line.startswith("-") and not line.startswith("---"):
            if "plugin" in line.lower() or "contextmenu" in line.lower() or "cache" in line.lower():
                print(f"Removed line: {line}")
                removed_plugins += 1
    print(f"Total relevant removed lines found: {removed_plugins}")
except Exception as e:
    print(f"Error checking git diff: {e}")
