with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
print("ALL SCRIPT TAGS IN index.html:")
for match in re.finditer(r'<script[^>]*>.*?</script>|<script[^>]*/>|<script[^>]*>', text, re.DOTALL):
    print(match.group(0).strip())
