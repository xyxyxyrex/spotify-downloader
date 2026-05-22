with open('tauri-gui/src/main.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re
print("OCCURRENCES OF 'views' OR 'navs' IN main.js:")
lines = text.splitlines()
for i, line in enumerate(lines):
    if 'views.' in line or 'navs.' in line or 'showView' in line or 'switchView' in line:
        print(f"{i+1}: {line.strip()}")
