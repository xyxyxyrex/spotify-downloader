with open('tauri-gui/src/plugins/spotify-wrapped.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re
print("SEARCHING FOR 'addEventListener' or 'window' or 'export' in spotify-wrapped.js:")
lines = text.splitlines()
for i, line in enumerate(lines):
    if 'addeventlistener' in line.lower() or 'window.' in line.lower() or 'export ' in line.lower():
        print(f"{i+1}: {line.strip()}")
