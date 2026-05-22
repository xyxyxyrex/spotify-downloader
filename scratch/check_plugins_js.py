with open('tauri-gui/src/main.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re
print("ANY OCCURRENCES OF 'plugin' OR 'plugins' IN main.js:")
lines = text.splitlines()
for i, line in enumerate(lines):
    if 'plugin' in line.lower():
        print(f"{i+1}: {line.strip()}")
