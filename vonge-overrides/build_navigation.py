import json
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])

items = json.loads(source.read_text(encoding='utf-8')) if source.exists() else []

# Vonge owns the public blog route. Keep the admin-friendly label while
# translating the old archive URL to Vonge's /blog/ page.
for item in items:
    if item.get('url') == '/archive/':
        item['url'] = '/blog/'

lines = ["logo_image:", "", "menu__settings:", "  menu__items:"]
for item in items:
    title = str(item.get('title', '')).replace("'", "''").strip()
    url = str(item.get('url', '')).strip()
    if not title or not url:
        continue
    lines.append(f"    - title: '{title}'")
    lines.append(f"      url: '{url}'")

# Keep GitHub accessible even if it is not stored in the editable menu.
lines.append("    - title: 'GitHub'")
lines.append("      url: 'https://github.com/sonomzy'")

destination.write_text("\n".join(lines) + "\n", encoding='utf-8')
