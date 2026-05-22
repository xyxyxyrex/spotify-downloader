with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'id="view-plugins"' in line or 'view-plugins' in line:
        print(f"Line {i+1}: {line.strip()}")
