import sys
import re

# Reconfigure stdout to handle UTF-8 printing on Windows
if sys.platform.startswith("win"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())

with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

print("SEARCHING FOR PLUGIN CARDS IN index.html:")
start = 0
while True:
    match = re.search(r'<div class="plugin-card"[^>]*>', text[start:])
    if not match:
        break
    card_start = start + match.start()
    print(text[card_start:card_start+1500])
    print("="*60)
    start = card_start + match.end()
