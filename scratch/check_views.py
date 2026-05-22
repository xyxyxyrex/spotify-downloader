import re

with open('tauri-gui/src/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

print("ALL VIEWS FOUND IN HTML:")
for match in re.finditer(r'id=["\']view-([^"\']+)["\']', html):
    print(f"- {match.group(0)}")

print("\nNAV-PLUGINS ELEMENT:")
for line in html.splitlines():
    if 'plugins' in line or 'plugin' in line:
        print(line.strip())
