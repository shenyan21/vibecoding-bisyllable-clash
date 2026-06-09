"""修复两个条目：从指定详情页重新抓取数据"""
import sys, json, re
from pathlib import Path
from playwright.sync_api import sync_playwright

PROFILE_DIR = Path(".tmp/douban_browser_profile")
JSONL_FILE = Path("data/childhood/scraped_items.jsonl")
CSV_FILE = Path("data/childhood/scraped_items.csv")

FIXES = {
    "秦时明月": "https://movie.douban.com/subject/3074717/",
    "巴啦啦小魔仙": "https://movie.douban.com/subject/3240884/",
}


def parse_subject_page(page, url: str) -> dict:
    """解析豆瓣详情页"""
    page.goto(url, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)

    item = {}

    # subject_id from URL
    m = re.search(r"subject/(\d+)", url)
    item["subject_id"] = m.group(1) if m else ""
    item["subject_url"] = url

    # title
    el = page.query_selector("h1 span.year")
    if el:
        year_text = el.inner_text().strip()
        title_el = page.query_selector("h1")
        if title_el:
            full_title = title_el.inner_text().strip()
            item["title"] = full_title.replace(year_text, "").strip()
    else:
        title_el = page.query_selector("h1")
        item["title"] = title_el.inner_text().strip() if title_el else ""

    # rating
    el = page.query_selector("strong.ll.rating_num")
    rating_text = el.inner_text().strip() if el else ""
    try:
        item["rating"] = float(rating_text) if rating_text else 0
    except ValueError:
        item["rating"] = 0

    # rating_count
    el = page.query_selector("a.rating_people span")
    item["rating_count"] = int(el.inner_text().strip().replace(",", "")) if el else 0

    # star_count
    item["star_count"] = round(item["rating"] / 2, 1) if item["rating"] else 0

    # is_tv
    el = page.query_selector('span[property="v:episode"]')
    item["is_tv"] = el is not None
    # Also check from info
    info_el = page.query_selector("#info")
    if info_el:
        info_text = info_el.inner_text()
        if "集数" in info_text:
            item["is_tv"] = True

    # labels
    labels = []
    for el in page.query_selector_all("div.tags a"):
        labels.append(el.inner_text().strip())
    # Also check for playable
    playable = page.query_selector("a.ticket-btn, a.bn-movie-ticket")
    if playable:
        labels.append("可播放")
    if item["is_tv"]:
        labels = ["剧集"] + [l for l in labels if l != "剧集"]
    else:
        labels = ["电影"] + [l for l in labels if l != "电影"]
    item["labels"] = labels

    # abstract from #info
    abstract_parts = []
    if info_el:
        info_text = info_el.inner_text()
        # Extract country
        m = re.search(r"制片国家/地区:\s*(.+)", info_text)
        if m:
            abstract_parts.append(m.group(1).strip())
        # Extract types
        types = [el.inner_text().strip() for el in page.query_selector_all('span[property="v:genre"]')]
        if types:
            abstract_parts.extend(types)
        # Extract aliases
        m = re.search(r"又名:\s*(.+)", info_text)
        if m:
            abstract_parts.append(m.group(1).strip())
        # Extract episode duration
        m = re.search(r"单集片长:\s*(.+)", info_text)
        if m:
            abstract_parts.append(m.group(1).strip())
        elif not item["is_tv"]:
            m = re.search(r"片长:\s*(.+)", info_text)
            if m:
                abstract_parts.append(m.group(1).strip())
        # Episode count
        m = re.search(r"集数:\s*(.+)", info_text)
        if m:
            abstract_parts.append(m.group(1).strip() + "集")
    item["abstract"] = " / ".join(abstract_parts)

    # abstract_2: director + actors
    abstract2_parts = []
    for el in page.query_selector_all('a[rel="v:directedBy"]'):
        abstract2_parts.append(el.inner_text().strip())
    for el in page.query_selector_all('a[rel="v:starring"]'):
        abstract2_parts.append(el.inner_text().strip())
    item["abstract_2"] = " / ".join(abstract2_parts[:15])

    # cover_url
    el = page.query_selector('img[rel="v:image"]')
    item["cover_url"] = el.get_attribute("src") if el else ""

    # Other fields
    item["parse_source"] = "playwright"
    item["tpl_name"] = "search_subject"
    item["search_url"] = ""
    item["source_page"] = 1
    item["source_page_start"] = 0

    return item


def main():
    # Load existing data
    with open(JSONL_FILE, "r", encoding="utf-8") as f:
        items = [json.loads(line.strip()) for line in f if line.strip()]

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        )
        page = context.new_page()

        for i, item in enumerate(items):
            title = item["title"]
            # Match by original search query or title
            for fix_title, fix_url in FIXES.items():
                # Check if this item was originally searched with this query
                search_url = item.get("search_url", "")
                if fix_title in title or f"q={fix_title}" in search_url.replace("%", "").lower() or fix_title in search_url:
                    print(f"修复: {title} -> {fix_url}")
                    new_data = parse_subject_page(page, fix_url)
                    # Preserve rank
                    new_data["rank"] = item["rank"]
                    # Update search_url from original
                    new_data["search_url"] = item.get("search_url", "")
                    items[i] = new_data
                    print(f"  新标题: {new_data['title']}, rating={new_data['rating']}, abstract={new_data['abstract'][:80]}")
                    break

        context.close()

    # Save JSONL
    with open(JSONL_FILE, "w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Save CSV
    import csv
    fieldnames = ["rank", "source_page", "source_page_start", "subject_id", "title", "rating", "rating_count", "star_count", "labels", "is_tv", "abstract", "abstract_2", "cover_url", "subject_url", "search_url", "parse_source", "tpl_name"]
    with open(CSV_FILE, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            row = dict(item)
            row["labels"] = "|".join(row.get("labels", []))
            writer.writerow(row)

    print(f"\n已保存 {len(items)} 条数据到 {JSONL_FILE} 和 {CSV_FILE}")


if __name__ == "__main__":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    main()
