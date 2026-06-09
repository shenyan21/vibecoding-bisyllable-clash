"""生成curl下载封面图片的批处理脚本"""
import json, re
from pathlib import Path

JSONL_FILE = Path("data/childhood/scraped_items.jsonl")
COVERS_DIR = Path("data/childhood/covers")
OUT_BAT = Path(".tmp/download_covers.bat")

def sanitize(name):
    name = name.replace(" ", "_")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    name = re.sub(r'_+', '_', name)
    return name.strip('_')

def main():
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    items = [json.loads(l.strip()) for l in open(JSONL_FILE, "r", encoding="utf-8") if l.strip()]

    existing = set()
    for p in COVERS_DIR.iterdir():
        if p.is_file():
            m = re.match(r'^(\d+)_', p.name)
            if m:
                existing.add(m.group(1))

    lines = ["@echo off", "cd /d e:\\codex_project\\hextech-bisyllable-duel"]
    count = 0
    for item in items:
        sid = item["subject_id"]
        if sid in existing:
            continue
        url = item.get("cover_url", "")
        if not url:
            continue
        safe_title = sanitize(item["title"])
        filename = f"{sid}_{safe_title}.webp"
        dest = str(COVERS_DIR / filename)
        lines.append(f'curl.exe --ssl-no-revoke -L -s -H "Referer: https://movie.douban.com/" -o "{dest}" "{url}"')
        count += 1

    lines.append("echo Done!")
    OUT_BAT.parent.mkdir(parents=True, exist_ok=True)
    OUT_BAT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Generated {count} download commands -> {OUT_BAT}")

if __name__ == "__main__":
    import io, sys
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    main()
