with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
start = text.find('id="view-settings"')
if start != -1:
    end = text.find('</main>', start)
    settings_section = text[start:end]
    print("ALL INPUTS IN VIEW-SETTINGS:")
    for match in re.finditer(r'<input[^>]+>', settings_section):
        print(match.group(0))
else:
    print("Could not find view-settings!")
