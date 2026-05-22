with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
print("SEARCHING VIEW-SETTINGS SECTION IN index.html:")
start = text.find('id="view-settings"')
if start != -1:
    end = text.find('</div>', start)
    # Let's extract around 2000 characters from start to get the settings form fields
    print(text[start:start+2500])
else:
    print("Could not find view-settings!")
