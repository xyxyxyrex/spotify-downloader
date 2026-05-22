with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
print("SEARCHING FOR WRAPPED IN index.html:")
for line in text.splitlines():
    if 'wrapped' in line.lower() or 'spotify-wrapped' in line.lower():
        print(line.strip())
