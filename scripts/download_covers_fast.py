"""用curl批量下载封面图片（最快方案）"""
import sys, json, re, subprocess
from pathlib import Path

JSONL_FILE = Path("data/childhood/scraped_items.jsonl")
COVERS_DIR = Path("data/childhood/covers")


def sanitize_filename(name: str) -> str:
    name = name.replace(" ", "_")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    name = re.sub(r'_+', '_', name)
    return name.strip('_')


def main():
    COVERS_DIR.mkdir(parents=True, exist_ok=True)

    with open(JSONL_FILE, "r", encoding="utf-8") as f:
        items = [json.loads(line.strip()) for line in f if line.strip()]

    print(f"共 {len(items)} 个条目")

    # 检查已下载
    existing = set()
    for p in COVERS_DIR.iterdir():
        if p.is_file() and p.suffix in ('.webp', '.jpg', '.png'):
            m = re.match(r'^(\d+)_', p.name)
            if m:
                existing.add(m.group(1))

    todo = [item for item in items if item["subject_id"] not in existing]
    print(f"已有 {len(existing)} 个封面，还需下载 {len(todo)} 个")

    if not todo:
        print("全部封面已下载！")
        return

    success = 0
    failed = 0
    for i, item in enumerate(todo):
        sid = item["subject_id"]
        title = item["title"]
        cover_url = item.get("cover_url", "")

        safe_title = sanitize_filename(title)
        filename = f"{sid}_{safe_title}.webp"
        dest = COVERS_DIR / filename

        if not cover_url:
            print(f"[{i+1}/{len(todo)}] {title} - 无封面URL")
            failed += 1
            continue

        if dest.exists() and dest.stat().st_size > 0:
            print(f"[{i+1}/{len(todo)}] {title} - 已存在")
            success += 1
            continue

        try:
            result = subprocess.run(
                ["curl.exe", "--ssl-no-revoke", "-L", "-s", "-o", str(dest), cover_url],
                capture_output=True, timeout=30
            )
            if dest.exists() and dest.stat().st_size > 1000:
                size_kb = dest.stat().st_size // 1024
                print(f"[{i+1}/{len(todo)}] {title} - OK ({size_kb}KB)")
                success += 1
            else:
                print(f"[{i+1}/{len(todo)}] {title} - 下载失败(文件太小或不存在)")
                if dest.exists():
                    dest.unlink()
                failed += 1
        except Exception as e:
            print(f"[{i+1}/{len(todo)}] {title} - 错误: {e}")
            failed += 1

    print(f"\n完成！成功 {success}，失败 {failed}，共 {len(todo)}")


if __name__ == "__main__":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    main()
